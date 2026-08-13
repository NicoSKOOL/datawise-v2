import type { Env } from '../index';
import { ACTIVITY_ERROR_CODE_HEADER } from '../activity';
import { refreshGSCToken } from './oauth';
import { isAdmin } from '../routes/admin';
import type { AuthUser } from '../auth/google';

interface SearchAnalyticsRow {
  keys: string[]; // [date, query, page]
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

const GSC_ROW_LIMIT = 25000;
// Safety ceiling so a pathologically large property cannot run the Worker
// out of CPU/subrequests. 30 pages * 25k = 750k rows per pass.
const GSC_MAX_PAGES = 30;

// Chunk size / ceiling for the full-path wipe below. 10k matches
// GSC_DISCONNECT_CHUNK; 200 chunks covers 2M rows, well past the largest
// single property observed.
const GSC_SYNC_DELETE_CHUNK = 10000;
const GSC_SYNC_MAX_DELETE_CHUNKS = 200;

// Long-tail write filter. Zero-click rows with <=2 impressions were ~70% of
// all stored gsc_search_data volume (measured 2026-08-12, DB at 9.06 GB of the
// 10 GB cap) yet power no dashboard number: opportunities and page2 gate on
// SUM(impressions) > 100 and top_queries sorts by clicks. Dropping them at
// write time is the durable half of the fix; the agg90 weekly rebuild and the
// sliding 35-day pd window then age the already-stored long tail out on their
// own. Marker rows (__daily_total__, __7d_query__) are never filtered.
export const GSC_LONGTAIL_MAX_IMPRESSIONS = 2;

export function hasSignal(row: SearchAnalyticsRow): boolean {
  return Number(row.clicks) > 0 || Number(row.impressions) > GSC_LONGTAIL_MAX_IMPRESSIONS;
}

// ---------------------------------------------------------------------------
// Upstream error handling
// ---------------------------------------------------------------------------
// Every non-OK Search Analytics response used to collapse into the same
// `{ error: 'Failed to fetch GSC data' }` 500, with Google's actual reason
// reaching console.error and nowhere else. app_events therefore recorded a bare
// status 500 and a NULL error_code, so four days of a user's failing syncs
// (bug 536e8205) could not be told apart from a rate limit, a revoked
// permission, or a Google outage. Keep the reason.

interface GSCApiFailure {
  status: number;  // HTTP status Google returned
  reason: string;  // error.errors[0].reason, or error.status
  message: string; // error.message, or the raw body for non-JSON responses
}

class GSCFetchError extends Error {
  constructor(readonly failure: GSCApiFailure) {
    super(`GSC_FETCH_FAILED_${failure.status}`);
  }
}

function parseGSCFailure(status: number, body: string): GSCApiFailure {
  let reason = '';
  let message = '';
  try {
    const parsed = JSON.parse(body) as {
      error?: { message?: string; status?: string; errors?: Array<{ reason?: string }> };
    };
    message = parsed.error?.message || '';
    reason = parsed.error?.errors?.[0]?.reason || parsed.error?.status || '';
  } catch {
    // Google serves an HTML error page for some edge/quota failures; the status
    // code is then the only signal, and the body is kept as the message.
  }
  return { status, reason, message: message || body.slice(0, 300) };
}

// Google rate-limits Search Console aggressively when several properties are
// synced back-to-back, and signals it as 429 OR as 403 with a quota reason.
const GSC_RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
  'RESOURCE_EXHAUSTED',
]);

function isRetryableFailure(f: GSCApiFailure): boolean {
  return f.status === 429 || f.status >= 500 || GSC_RATE_LIMIT_REASONS.has(f.reason);
}

// One POST to Search Analytics, with a single backoff retry for the transient
// classes. A retry is far cheaper than the user re-clicking Sync, and the
// bursty rate limits Google applies here usually clear within a second.
async function gscSearchAnalyticsFetch(
  apiUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ rows?: SearchAnalyticsRow[] }> {
  for (let attempt = 0; ; attempt++) {
    const resp = await fetch(apiUrl, { method: 'POST', headers, body: JSON.stringify(body) });
    if (resp.ok) return await resp.json() as { rows?: SearchAnalyticsRow[] };

    const failure = parseGSCFailure(resp.status, await resp.text().catch(() => ''));
    if (attempt === 0 && isRetryableFailure(failure)) {
      console.warn('GSC searchAnalytics retryable failure, retrying:', failure.status, failure.reason);
      await new Promise(resolve => setTimeout(resolve, 1200));
      continue;
    }
    console.error('GSC searchAnalytics API error:', failure.status, failure.reason, failure.message);
    throw new GSCFetchError(failure);
  }
}

// Maps an upstream failure onto a response the SPA can act on. The old generic
// 500 told the user nothing, so they retried the same broken thing for days.
function gscFailureResponse(failure: GSCApiFailure, siteUrl: string): Response {
  let status = 502;
  let code = 'gsc_upstream_error';
  let error = `Google Search Console returned an error for ${siteUrl}.`;

  if (isRetryableFailure(failure)) {
    status = 429;
    code = 'gsc_rate_limited';
    error = `Google is rate-limiting Search Console requests for ${siteUrl}. Wait a minute and sync again — syncing several sites at once is the usual trigger.`;
  } else if (failure.status === 403 || failure.status === 401) {
    status = 403;
    code = 'gsc_property_forbidden';
    error = `Your Google account no longer has permission to read ${siteUrl} in Search Console. Check that the property still exists and that your account still has access, then reconnect.`;
  } else if (failure.status === 400) {
    code = 'gsc_bad_request';
    error = `Google rejected the Search Console request for ${siteUrl}. The property may have been renamed or removed in Search Console; refresh your property list.`;
  }

  return new Response(
    JSON.stringify({ error, code, google_status: failure.status, google_reason: failure.reason || null }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        [ACTIVITY_ERROR_CODE_HEADER]: `${code}:${failure.status}${failure.reason ? `:${failure.reason}` : ''}`,
      },
    },
  );
}

// Fetch every row for a Search Analytics query by walking startRow until a
// short page (or the safety ceiling) is hit. The GSC API caps a single
// response at 25k rows; without this loop everything past row 25k is lost.
async function fetchAllSearchAnalyticsRows(
  apiUrl: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
): Promise<{ rows: SearchAnalyticsRow[]; truncated: boolean }> {
  const all: SearchAnalyticsRow[] = [];
  for (let page = 0; page < GSC_MAX_PAGES; page++) {
    const data = await gscSearchAnalyticsFetch(apiUrl, headers, {
      ...body,
      rowLimit: GSC_ROW_LIMIT,
      startRow: page * GSC_ROW_LIMIT,
    });
    const rows = data.rows || [];
    all.push(...rows);
    if (rows.length < GSC_ROW_LIMIT) return { rows: all, truncated: false };
  }
  console.warn(`GSC pagination hit ${GSC_MAX_PAGES}-page ceiling; data may be truncated`);
  return { rows: all, truncated: true };
}

// POST /gsc/sync - Fetch Search Analytics data for a property
export async function handleGSCSync(request: Request, env: Env, userId: string): Promise<Response> {
  const { property_id, trigger } = await request.json() as { property_id: string; trigger?: 'scheduled' };
  if (!property_id) {
    return new Response(JSON.stringify({ error: 'property_id required' }), { status: 400 });
  }

  // Verify property belongs to user
  const property = await env.DB.prepare(
    'SELECT id, site_url FROM gsc_properties WHERE id = ? AND user_id = ?'
  ).bind(property_id, userId).first();

  if (!property) {
    return new Response(JSON.stringify({ error: 'Property not found' }), { status: 404 });
  }

  // Get fresh access token
  const accessToken = await refreshGSCToken(env, userId);
  if (!accessToken) {
    // Distinct code lets the SPA show a "Reconnect Google" CTA instead of a
    // generic "Failed to fetch GSC data" toast (bug f83f0ecd was opaque
    // because the user saw the generic message and didn't know to reconnect).
    return new Response(JSON.stringify({
      error: 'GSC not connected or token expired. Please reconnect.',
      code: 'gsc_reauth_required',
    }), { status: 403 });
  }

  const siteUrl = property.site_url as string;
  const formatDate = (d: Date) => d.toISOString().split('T')[0];
  const apiUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  const now = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // --- Incremental sync state ---
  // A property synced since the two-set model shipped has source='pd' rows.
  // For those, only the data GSC could have changed since the last sync is
  // refetched and rewritten; the old DELETE-all + full 90-day reinsert was
  // the dominant D1 rows-written cost. Properties still on legacy
  // source='gsc' rows (or never synced) take the full path, which converts
  // them, so the two formats still never coexist for a property.
  const syncState = await env.DB.prepare(
    `SELECT MAX(CASE WHEN source = 'pd' THEN date END) as last_pd_date,
            MAX(CASE WHEN source = 'agg90' THEN date END) as agg90_stamp
       FROM gsc_search_data WHERE property_id = ?`
  ).bind(property_id).first<{ last_pd_date: string | null; agg90_stamp: string | null }>();
  const lastPdDate = syncState?.last_pd_date || null;
  const incremental = lastPdDate !== null;

  // The 90-day aggregate cannot be built incrementally (it is one rolling
  // window), but it barely moves between cron runs. Scheduled syncs reuse it
  // for up to 7 days; the manual Sync button always rebuilds it fresh.
  let refreshAgg90 = true;
  if (incremental && trigger === 'scheduled' && syncState?.agg90_stamp) {
    const ageMs = now.getTime() - new Date(`${syncState.agg90_stamp}T00:00:00Z`).getTime();
    refreshAgg90 = ageMs >= 7 * 86400000;
  }

  // --- Pass 1: Daily totals (dimensions: ['date']) ---
  // ~90 rows, never truncated, gives accurate daily click/impression totals
  let dailyRows: SearchAnalyticsRow[];
  try {
    const dailyData = await gscSearchAnalyticsFetch(apiUrl, headers, {
      startDate: formatDate(ninetyDaysAgo),
      endDate: formatDate(now),
      dimensions: ['date'],
      rowLimit: 25000,
      dataState: 'final',
    });
    dailyRows = dailyData.rows || [];
  } catch (err) {
    if (err instanceof GSCFetchError) return gscFailureResponse(err.failure, siteUrl);
    throw err;
  }
  const totalClicks = dailyRows.reduce((sum, row) => sum + Number(row.clicks || 0), 0);
  const totalImpressions = dailyRows.reduce((sum, row) => sum + Number(row.impressions || 0), 0);

  // A 200-OK Search Analytics response with zero rows must never overwrite good
  // stored data with nothing. Google returns an empty set for a day or two right
  // after a site is re-verified or its URL/property changes; the destructive
  // rewrite below would then DELETE the '__daily_total__' rows the dashboard sums
  // and re-insert nothing, so every range read "0" until the next sync (bug
  // fc3660cd: "dashboard showing 0 for all three websites" after a manual
  // re-sync). Treat an empty daily-totals fetch as transient and leave stored
  // data untouched. Nothing was deleted yet, so bailing here is fully safe.
  if (dailyRows.length === 0) {
    return new Response(JSON.stringify({
      success: true,
      mode: 'skipped',
      reason: 'empty_daily_totals',
      rows_synced: 0,
      property: siteUrl,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // --- Pass 2a: Full 90-day query+page aggregate (no date dimension) ---
  // Stored as source='agg90'. Powers the default dashboard, /gsc/queries,
  // and the 90-day range. Paginated, so large sites are no longer capped
  // at 25k rows (the old 3x25k batch scheme silently dropped the long tail).
  // Skipped entirely when a scheduled sync can reuse a recent aggregate.
  let aggRows: SearchAnalyticsRow[] = [];
  if (refreshAgg90) {
    try {
      aggRows = (await fetchAllSearchAnalyticsRows(apiUrl, headers, {
        startDate: formatDate(ninetyDaysAgo),
        endDate: formatDate(now),
        dimensions: ['query', 'page'],
        dataState: 'final',
      })).rows;
      aggRows = aggRows.filter(hasSignal);
    } catch (err) {
      if (err instanceof GSCFetchError) return gscFailureResponse(err.failure, siteUrl);
      throw err;
    }
  }

  // --- Pass 2b: Per-day query+page for the last 35 days ---
  // Stored as source='pd' with the REAL per-day date (keys[0]). Powers the
  // date-accurate 7/14/30-day range panels. The 35-day window bounds row
  // volume; the 90-day view uses the aggregate above instead.
  const thirtyFiveDaysAgo = new Date(now);
  thirtyFiveDaysAgo.setDate(thirtyFiveDaysAgo.getDate() - 35);
  // Incremental: refetch only from 2 days before the newest stored per-day
  // row. dataState:'final' rows do not change once published, so older days
  // are already correct; the 2-day overlap absorbs late finalization at the
  // edge of the window.
  let pdStart = thirtyFiveDaysAgo;
  if (incremental) {
    const overlapStart = new Date(`${lastPdDate}T00:00:00Z`);
    overlapStart.setUTCDate(overlapStart.getUTCDate() - 2);
    if (overlapStart > pdStart) pdStart = overlapStart;
  }
  let perDayRows: SearchAnalyticsRow[];
  try {
    perDayRows = (await fetchAllSearchAnalyticsRows(apiUrl, headers, {
      startDate: formatDate(pdStart),
      endDate: formatDate(now),
      dimensions: ['date', 'query', 'page'],
      dataState: 'final',
    })).rows;
    perDayRows = perDayRows.filter(hasSignal);
  } catch (err) {
    if (err instanceof GSCFetchError) return gscFailureResponse(err.failure, siteUrl);
    throw err;
  }

  // --- Pass 3: 7-day query breakdown (dimensions: ['query']) ---
  // Separate call for recent query-level data the user asks about most
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  // Non-fatal on purpose: this pass only feeds the "recent queries" panel, so a
  // failure here leaves the existing 7-day rows in place rather than sinking an
  // otherwise complete sync (query7dFetched gates the matching DELETE below).
  let query7dRows: SearchAnalyticsRow[] = [];
  let query7dFetched = true;
  try {
    const data = await gscSearchAnalyticsFetch(apiUrl, headers, {
      startDate: formatDate(sevenDaysAgo),
      endDate: formatDate(now),
      dimensions: ['query'],
      rowLimit: 25000,
      dataState: 'final',
    });
    query7dRows = data.rows || [];
  } catch (err) {
    if (!(err instanceof GSCFetchError)) throw err;
    query7dFetched = false;
  }

  // All GSC fetches are done; only now is stored data mutated, so a failed
  // fetch can never strand a property with deleted data.
  if (!incremental) {
    // First sync, or legacy-format property: full wipe-and-reload converts it
    // to the two-set model. From then on syncs take the incremental path.
    //
    // Chunked for the same reason handleGSCDisconnect is: D1 caps a single SQL
    // statement at 30 seconds, and a one-shot DELETE of a legacy property
    // holding hundreds of thousands of rows blows that cap and 500s the whole
    // sync — right after the fetches succeeded, so the user pays for the work
    // and gets nothing. Safe to interrupt: rows only shrink and nothing has
    // been re-inserted yet.
    for (let i = 0; i < GSC_SYNC_MAX_DELETE_CHUNKS; i++) {
      const res = await env.DB.prepare(
        `DELETE FROM gsc_search_data WHERE id IN (
           SELECT id FROM gsc_search_data WHERE property_id = ? LIMIT ?
         )`
      ).bind(property_id, GSC_SYNC_DELETE_CHUNK).run();
      if ((res.meta?.changes ?? 0) < GSC_SYNC_DELETE_CHUNK) break;
    }
  } else {
    // Targeted deletes covering exactly the row sets rewritten below.
    const deletes = [
      // Daily totals: ~90 rows, replaced wholesale (window slides daily).
      env.DB.prepare(
        `DELETE FROM gsc_search_data WHERE property_id = ? AND query = '__daily_total__'`
      ).bind(property_id),
      // Per-day rows inside the refetched overlap window.
      env.DB.prepare(
        `DELETE FROM gsc_search_data WHERE property_id = ? AND source = 'pd' AND date >= ?`
      ).bind(property_id, formatDate(pdStart)),
      // Per-day rows that slid out of the 35-day window.
      env.DB.prepare(
        `DELETE FROM gsc_search_data WHERE property_id = ? AND source = 'pd' AND date < ?`
      ).bind(property_id, formatDate(thirtyFiveDaysAgo)),
    ];
    if (query7dFetched) {
      deletes.push(env.DB.prepare(
        `DELETE FROM gsc_search_data WHERE property_id = ? AND page = '__7d_query__'`
      ).bind(property_id));
    }
    if (refreshAgg90) {
      deletes.push(env.DB.prepare(
        `DELETE FROM gsc_search_data WHERE property_id = ? AND source = 'agg90'`
      ).bind(property_id));
    }
    await env.DB.batch(deletes);
  }

  // Insert daily totals (query = '__daily_total__' to distinguish from query-level rows)
  // 500/batch (D1 allows up to 1000 statements) keeps round-trips low so large
  // properties finish re-inserting well within the Worker time budget.
  const insertBatchSize = 500;
  for (let i = 0; i < dailyRows.length; i += insertBatchSize) {
    const batch = dailyRows.slice(i, i + insertBatchSize);
    const stmts = batch.map(row =>
      env.DB.prepare(
        'INSERT INTO gsc_search_data (property_id, date, query, page, clicks, impressions, ctr, position, device, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(property_id, row.keys[0], '__daily_total__', null, row.clicks, row.impressions, row.ctr, row.position, null, null)
    );
    await env.DB.batch(stmts);
  }

  // Insert 7-day query breakdown
  const today = formatDate(now);
  for (let i = 0; i < query7dRows.length; i += insertBatchSize) {
    const batch = query7dRows.slice(i, i + insertBatchSize);
    const stmts = batch.map(row =>
      env.DB.prepare(
        'INSERT INTO gsc_search_data (property_id, date, query, page, clicks, impressions, ctr, position, device, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(property_id, today, row.keys[0], '__7d_query__', row.clicks, row.impressions, row.ctr, row.position, null, null)
    );
    await env.DB.batch(stmts);
  }

  // Insert the 90-day query+page aggregate (source='agg90'). keys = [query, page].
  // Date is irrelevant for this set (consumers ignore it / use the 90d range),
  // so it is stamped 'today' purely to satisfy the NOT NULL date column.
  for (let i = 0; i < aggRows.length; i += insertBatchSize) {
    const batch = aggRows.slice(i, i + insertBatchSize);
    const stmts = batch.map(row =>
      env.DB.prepare(
        'INSERT INTO gsc_search_data (property_id, date, query, page, clicks, impressions, ctr, position, device, country, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(property_id, today, row.keys[0], row.keys[1], row.clicks, row.impressions, row.ctr, row.position, null, null, 'agg90')
    );
    await env.DB.batch(stmts);
  }

  // Insert per-day query+page rows (source='pd'). keys = [date, query, page].
  // The real per-day date is stored so 7/14/30-day ranges filter accurately.
  for (let i = 0; i < perDayRows.length; i += insertBatchSize) {
    const batch = perDayRows.slice(i, i + insertBatchSize);
    const stmts = batch.map(row =>
      env.DB.prepare(
        'INSERT INTO gsc_search_data (property_id, date, query, page, clicks, impressions, ctr, position, device, country, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(property_id, row.keys[0], row.keys[1], row.keys[2], row.clicks, row.impressions, row.ctr, row.position, null, null, 'pd')
    );
    await env.DB.batch(stmts);
  }

  // Update last_synced_at. A successful sync also clears purged_at: the
  // property has live data again, so it re-enters the normal lifecycle
  // (and becomes purge-eligible again only after another 60 days dormant).
  await env.DB.prepare(
    'UPDATE gsc_properties SET last_synced_at = datetime("now"), purged_at = NULL WHERE id = ?'
  ).bind(property_id).run();

  const totalRows = dailyRows.length + query7dRows.length + aggRows.length + perDayRows.length;
  return new Response(JSON.stringify({
    success: true,
    mode: incremental ? 'incremental' : 'full',
    agg90_refreshed: refreshAgg90,
    rows_synced: totalRows,
    daily_rows: dailyRows.length,
    query_7d_rows: query7dRows.length,
    query_agg90_rows: aggRows.length,
    query_perday_rows: perDayRows.length,
    total_clicks: totalClicks,
    total_impressions: totalImpressions,
    property: siteUrl,
  }), { headers: { 'Content-Type': 'application/json' } });
}

// GET /gsc/data?property_id=xxx - Get synced GSC data summary for LLM context
export async function handleGSCData(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const propertyId = url.searchParams.get('property_id');

  if (!propertyId) {
    return new Response(JSON.stringify({ error: 'property_id required' }), { status: 400 });
  }

  // Verify ownership
  const property = await env.DB.prepare(
    'SELECT id, site_url, last_synced_at FROM gsc_properties WHERE id = ? AND user_id = ?'
  ).bind(propertyId, userId).first();

  if (!property) {
    return new Response(JSON.stringify({ error: 'Property not found' }), { status: 404 });
  }

  // Cache the computed dashboard. This endpoint runs ~15 GROUP BY scans over
  // gsc_search_data (tens of millions of rows) per load, so uncached it was the
  // single largest source of D1 rows-read (the rangeOpps correlated subquery
  // alone read ~117M rows/day). GSC data only changes when a sync runs, and
  // syncProperty bumps last_synced_at, so keying on it makes a fresh sync
  // invalidate the cache automatically. The TTL is just a backstop for the
  // daily date('now') window rollover on properties that are not re-synced.
  // The ownership check above stays live (cheap, indexed) so cross-user reads
  // can never be served from cache.
  const GSC_DATA_CACHE_TTL = 6 * 60 * 60; // 6 hours
  const cacheKey = `gsc_data:v1:${propertyId}:${url.searchParams.get('range') || 'none'}:${String(property.last_synced_at ?? 'never')}`;
  const cachedBody = await env.KV.get(cacheKey);
  if (cachedBody) {
    return new Response(cachedBody, {
      headers: { 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
    });
  }

  // Accurate summaries from daily total rows
  const summary7d = await env.DB.prepare(`
    SELECT SUM(clicks) as total_clicks, SUM(impressions) as total_impressions,
           ROUND(AVG(position), 1) as avg_position
    FROM gsc_search_data WHERE property_id = ? AND query = '__daily_total__' AND date >= date('now', '-7 days')
  `).bind(propertyId).first();

  const summary30d = await env.DB.prepare(`
    SELECT SUM(clicks) as total_clicks, SUM(impressions) as total_impressions,
           ROUND(AVG(position), 1) as avg_position
    FROM gsc_search_data WHERE property_id = ? AND query = '__daily_total__' AND date >= date('now', '-30 days')
  `).bind(propertyId).first();

  const summary90d = await env.DB.prepare(`
    SELECT SUM(clicks) as total_clicks, SUM(impressions) as total_impressions,
           ROUND(AVG(position), 1) as avg_position
    FROM gsc_search_data WHERE property_id = ? AND query = '__daily_total__'
  `).bind(propertyId).first();

  const querySummary = await env.DB.prepare(`
    WITH query_rollup AS (
      SELECT
        query,
        ROUND(AVG(position), 1) as avg_position,
        SUM(impressions) as impressions
      FROM gsc_search_data
      WHERE property_id = ? AND (source = 'agg90' OR source = 'gsc') AND query != '__daily_total__' AND page != '__7d_query__'
      GROUP BY query
    )
    SELECT
      COUNT(*) as total_queries,
      ROUND(AVG(avg_position), 1) as avg_position,
      SUM(CASE WHEN avg_position <= 3 THEN 1 ELSE 0 END) as top_3,
      SUM(CASE WHEN avg_position <= 10 THEN 1 ELSE 0 END) as top_10,
      SUM(CASE WHEN avg_position <= 20 THEN 1 ELSE 0 END) as top_20,
      SUM(CASE WHEN avg_position BETWEEN 11 AND 20 THEN 1 ELSE 0 END) as striking_distance,
      SUM(CASE WHEN avg_position <= 10 THEN impressions ELSE 0 END) as top_10_impressions
    FROM query_rollup
  `).bind(propertyId).first();

  // Top queries by clicks (from query+page batch data)
  const topQueries = await env.DB.prepare(`
    SELECT query, SUM(clicks) as clicks, SUM(impressions) as impressions,
           ROUND(AVG(position), 1) as avg_position, ROUND(AVG(ctr), 4) as avg_ctr
    FROM gsc_search_data WHERE property_id = ? AND (source = 'agg90' OR source = 'gsc') AND query != '__daily_total__' AND page != '__7d_query__'
    GROUP BY query ORDER BY clicks DESC LIMIT 50
  `).bind(propertyId).all();

  // Top pages by clicks
  const topPages = await env.DB.prepare(`
    SELECT page, SUM(clicks) as clicks, SUM(impressions) as impressions,
           ROUND(AVG(position), 1) as avg_position
    FROM gsc_search_data WHERE property_id = ? AND (source = 'agg90' OR source = 'gsc') AND query != '__daily_total__' AND page != '__7d_query__'
    GROUP BY page ORDER BY clicks DESC LIMIT 30
  `).bind(propertyId).all();

  // Opportunity keywords
  const opportunities = await env.DB.prepare(`
    SELECT query, SUM(clicks) as clicks, SUM(impressions) as impressions,
           ROUND(AVG(position), 1) as avg_position, ROUND(AVG(ctr), 4) as avg_ctr
    FROM gsc_search_data WHERE property_id = ? AND (source = 'agg90' OR source = 'gsc') AND query != '__daily_total__' AND page != '__7d_query__'
    GROUP BY query
    HAVING AVG(position) BETWEEN 5 AND 20 AND SUM(impressions) > 100
    ORDER BY impressions DESC LIMIT 30
  `).bind(propertyId).all();

  const recentQueries = await env.DB.prepare(`
    SELECT query, clicks, impressions,
           ROUND(position, 1) as avg_position, ROUND(ctr * 100, 1) as ctr_pct
    FROM gsc_search_data
    WHERE property_id = ? AND page = '__7d_query__'
    ORDER BY clicks DESC LIMIT 25
  `).bind(propertyId).all();

  // Daily trend data for charts (last 30 days)
  const dailyTrend = await env.DB.prepare(`
    SELECT date, clicks, impressions
    FROM gsc_search_data
    WHERE property_id = ? AND query = '__daily_total__' AND date >= date('now', '-30 days')
    ORDER BY date ASC
  `).bind(propertyId).all();

  // Optional, ADDITIVE range block for the dashboard time selector.
  // When ?range= is absent or invalid the response is unchanged (other
  // callers, including the SEO Assistant LLM context, are unaffected).
  const ALLOWED_RANGES = [7, 14, 30, 90];
  const requestedRange = Number(url.searchParams.get('range'));
  let rangeBlock: Record<string, unknown> | null = null;
  if (ALLOWED_RANGES.includes(requestedRange)) {
    const n = requestedRange;
    // Backward compatible: a re-synced property has source='agg90'/'pd' rows
    // (legacy source='gsc' query+page rows were DELETEd by the sync); a not-yet
    // re-synced property still only has legacy source='gsc' query+page rows.
    // The two never coexist for a property, so OR-ing them never double counts.
    // Ranges up to 35 days use the date-accurate per-day set (falls back to the
    // legacy mis-dated rows pre-resync = prior behavior); 90 uses the aggregate.
    const legacyQP = `query != '__daily_total__' AND page != '__7d_query__'`;
    const qpScope = n <= 35
      ? `((source = 'pd') OR (source = 'gsc' AND ${legacyQP})) AND date >= date('now', '-${n} days')`
      : `((source = 'agg90' OR source = 'gsc') AND ${legacyQP})`;
    const qpScopeG = n <= 35
      ? `((g.source = 'pd') OR (g.source = 'gsc' AND g.query != '__daily_total__' AND g.page != '__7d_query__')) AND g.date >= date('now', '-${n} days')`
      : `((g.source = 'agg90' OR g.source = 'gsc') AND g.query != '__daily_total__' AND g.page != '__7d_query__')`;
    const qpScopeP = n <= 35
      ? `((p.source = 'pd') OR (p.source = 'gsc' AND p.query != '__daily_total__' AND p.page != '__7d_query__')) AND p.date >= date('now', '-${n} days')`
      : `((p.source = 'agg90' OR p.source = 'gsc') AND p.query != '__daily_total__' AND p.page != '__7d_query__')`;
    const cur = await env.DB.prepare(`
      SELECT SUM(clicks) as clicks, SUM(impressions) as impressions,
             ROUND(AVG(position), 1) as avg_position
      FROM gsc_search_data
      WHERE property_id = ? AND query = '__daily_total__' AND date >= date('now', '-${n} days')
    `).bind(propertyId).first();

    const prev = await env.DB.prepare(`
      SELECT SUM(clicks) as clicks, SUM(impressions) as impressions,
             ROUND(AVG(position), 1) as avg_position
      FROM gsc_search_data
      WHERE property_id = ? AND query = '__daily_total__'
        AND date >= date('now', '-${n * 2} days') AND date < date('now', '-${n} days')
    `).bind(propertyId).first();

    const rangeDaily = await env.DB.prepare(`
      SELECT date, clicks, impressions
      FROM gsc_search_data
      WHERE property_id = ? AND query = '__daily_total__' AND date >= date('now', '-${n} days')
      ORDER BY date ASC
    `).bind(propertyId).all();

    const rangeQuery = await env.DB.prepare(`
      WITH rollup AS (
        SELECT query, ROUND(AVG(position), 1) as avg_position, SUM(impressions) as impressions
        FROM gsc_search_data
        WHERE property_id = ? AND ${qpScope}
        GROUP BY query
      )
      SELECT
        SUM(CASE WHEN avg_position BETWEEN 11 AND 20 THEN 1 ELSE 0 END) as striking_distance,
        SUM(CASE WHEN avg_position <= 10 THEN 1 ELSE 0 END) as top_10
      FROM rollup
    `).bind(propertyId).first();

    const rangeOpps = await env.DB.prepare(`
      SELECT g.query as query, SUM(g.clicks) as clicks, SUM(g.impressions) as impressions,
             ROUND(AVG(g.position), 1) as avg_position, ROUND(AVG(g.ctr), 4) as avg_ctr,
             (SELECT p.page FROM gsc_search_data p
                WHERE p.property_id = g.property_id AND p.query = g.query
                  AND p.page IS NOT NULL AND ${qpScopeP}
                GROUP BY p.page ORDER BY SUM(p.impressions) DESC LIMIT 1) as page
      FROM gsc_search_data g
      WHERE g.property_id = ? AND ${qpScopeG}
      GROUP BY g.query
      HAVING AVG(g.position) BETWEEN 5 AND 20 AND SUM(g.impressions) > 10
      ORDER BY impressions DESC LIMIT 30
    `).bind(propertyId).all();

    const rangeTopPages = await env.DB.prepare(`
      SELECT page, SUM(clicks) as clicks, SUM(impressions) as impressions,
             ROUND(AVG(position), 1) as avg_position
      FROM gsc_search_data
      WHERE property_id = ? AND page IS NOT NULL AND ${qpScope}
      GROUP BY page
      ORDER BY clicks DESC LIMIT 12
    `).bind(propertyId).all();

    const prevClicks = prev?.clicks != null ? Number(prev.clicks) : null;
    const prevImpr = prev?.impressions != null ? Number(prev.impressions) : null;
    rangeBlock = {
      days: n,
      clicks: Number(cur?.clicks || 0),
      impressions: Number(cur?.impressions || 0),
      avg_position: cur?.avg_position != null ? Number(cur.avg_position) : null,
      prev_clicks: prevClicks,
      prev_impressions: prevImpr,
      prev_avg_position: prev?.avg_position != null ? Number(prev.avg_position) : null,
      striking_distance: Number(rangeQuery?.striking_distance || 0),
      top_10: Number(rangeQuery?.top_10 || 0),
      daily: rangeDaily.results || [],
      opportunities: rangeOpps.results || [],
      top_pages: rangeTopPages.results || [],
    };
  }

  const responseBody = JSON.stringify({
    property: property.site_url,
    last_synced: property.last_synced_at,
    daily_trend: dailyTrend.results || [],
    ...(rangeBlock ? { range: rangeBlock } : {}),
    summary: { last_7_days: summary7d, last_30_days: summary30d, last_90_days: summary90d },
    query_summary: {
      total_queries: Number(querySummary?.total_queries || 0),
      avg_position: querySummary?.avg_position != null ? Number(querySummary.avg_position) : null,
      top_3: Number(querySummary?.top_3 || 0),
      top_10: Number(querySummary?.top_10 || 0),
      top_20: Number(querySummary?.top_20 || 0),
      striking_distance: Number(querySummary?.striking_distance || 0),
      top_10_impressions: Number(querySummary?.top_10_impressions || 0),
    },
    recent_queries: recentQueries.results,
    top_queries: topQueries.results,
    top_pages: topPages.results,
    opportunities: opportunities.results,
  });

  // Best-effort cache write: never fail the request if KV is unavailable.
  try {
    await env.KV.put(cacheKey, responseBody, { expirationTtl: GSC_DATA_CACHE_TTL });
  } catch (e) {
    console.error('gsc_data cache put failed:', e);
  }

  return new Response(responseBody, {
    headers: { 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
  });
}

// GET /gsc/queries?property_id=xxx&filter=all|top10|page2|opportunities&search=...&sort=clicks&order=desc&limit=100&offset=0
// With filter=page2&page=<url>: returns the queries behind that single page (mode 'page_queries')
export async function handleGSCQueries(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const propertyId = url.searchParams.get('property_id');
  const filter = url.searchParams.get('filter') || 'all';
  const search = url.searchParams.get('search') || '';
  const sort = url.searchParams.get('sort') || 'clicks';
  const order = url.searchParams.get('order') || 'desc';
  const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
  const offset = Number(url.searchParams.get('offset') || 0);

  if (!propertyId) {
    return new Response(JSON.stringify({ error: 'property_id required' }), { status: 400 });
  }

  // Verify ownership
  const property = await env.DB.prepare(
    'SELECT id FROM gsc_properties WHERE id = ? AND user_id = ?'
  ).bind(propertyId, userId).first();

  if (!property) {
    return new Response(JSON.stringify({ error: 'Property not found' }), { status: 404 });
  }

  const allowedSorts = ['clicks', 'impressions', 'avg_position', 'avg_ctr'];
  const sortCol = allowedSorts.includes(sort) ? sort : 'clicks';
  const sortOrder = order === 'asc' ? 'ASC' : 'DESC';

  const baseWhere = `property_id = ? AND (source = 'agg90' OR source = 'gsc') AND query != '__daily_total__' AND page != '__7d_query__'`;

  // "page2" groups by page URL; everything else groups by query
  if (filter === 'page2') {
    // Drill-down: ?page=<url> returns the individual queries behind one
    // Page 2 row, using the same baseWhere so numbers reconcile with the
    // parent aggregate.
    const drillPage = url.searchParams.get('page');
    if (drillPage) {
      const drillSql = `
        SELECT query,
               SUM(clicks) as clicks,
               SUM(impressions) as impressions,
               ROUND(AVG(position), 1) as avg_position,
               ROUND(AVG(ctr), 4) as avg_ctr
        FROM gsc_search_data WHERE ${baseWhere} AND page = ?
        GROUP BY query
        ORDER BY impressions DESC
        LIMIT 50
      `;
      const drillResult = await env.DB.prepare(drillSql).bind(propertyId, drillPage).all();
      return new Response(JSON.stringify({
        rows: drillResult.results,
        mode: 'page_queries',
        total: drillResult.results.length,
        limit: 50,
        offset: 0,
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    const searchClause = search ? 'AND page LIKE ?' : '';
    const searchParam = search ? `%${search}%` : null;
    const whereClause = `${baseWhere} ${searchClause}`;
    const params = searchParam ? [propertyId, searchParam] : [propertyId];

    const countSql = `
      SELECT COUNT(*) as total FROM (
        SELECT page
        FROM gsc_search_data WHERE ${whereClause}
        GROUP BY page
        HAVING AVG(position) BETWEEN 11 AND 20 AND SUM(impressions) > 100
      )
    `;
    const countResult = await env.DB.prepare(countSql).bind(...params).first();
    const total = Number(countResult?.total || 0);

    const dataSql = `
      SELECT page,
             SUM(clicks) as clicks,
             SUM(impressions) as impressions,
             ROUND(AVG(position), 1) as avg_position,
             ROUND(AVG(ctr), 4) as avg_ctr,
             COUNT(DISTINCT query) as query_count
      FROM gsc_search_data WHERE ${whereClause}
      GROUP BY page
      HAVING AVG(position) BETWEEN 11 AND 20 AND SUM(impressions) > 100
      ORDER BY ${sortCol} ${sortOrder}
      LIMIT ? OFFSET ?
    `;
    const dataResult = await env.DB.prepare(dataSql).bind(...params, limit, offset).all();

    return new Response(JSON.stringify({
      rows: dataResult.results,
      mode: 'pages',
      total,
      limit,
      offset,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Query-based filters: all, top10, opportunities
  const searchClause = search ? 'AND query LIKE ?' : '';
  const searchParam = search ? `%${search}%` : null;
  const whereClause = `${baseWhere} ${searchClause}`;
  const params = searchParam ? [propertyId, searchParam] : [propertyId];

  let havingClause = '';
  // top10: no position filter, we just take the top 10 by traffic
  // opportunities: position 5-20 with high impressions
  if (filter === 'opportunities') {
    havingClause = 'HAVING AVG(position) BETWEEN 5 AND 20 AND SUM(impressions) > 100';
  }

  const effectiveLimit = filter === 'top10' ? 10 : limit;
  const effectiveOffset = filter === 'top10' ? 0 : offset;

  const countSql = `
    SELECT COUNT(*) as total FROM (
      SELECT query
      FROM gsc_search_data WHERE ${whereClause}
      GROUP BY query
      ${havingClause}
    )
  `;
  const countResult = await env.DB.prepare(countSql).bind(...params).first();
  const total = filter === 'top10' ? Math.min(Number(countResult?.total || 0), 10) : Number(countResult?.total || 0);

  const dataSql = `
    SELECT query,
           SUM(clicks) as clicks,
           SUM(impressions) as impressions,
           ROUND(AVG(position), 1) as avg_position,
           ROUND(AVG(ctr), 4) as avg_ctr
    FROM gsc_search_data WHERE ${whereClause}
    GROUP BY query
    ${havingClause}
    ORDER BY ${filter === 'top10' ? 'clicks DESC' : `${sortCol} ${sortOrder}`}
    LIMIT ? OFFSET ?
  `;
  const dataResult = await env.DB.prepare(dataSql).bind(...params, effectiveLimit, effectiveOffset).all();

  return new Response(JSON.stringify({
    rows: dataResult.results,
    mode: 'queries',
    total,
    limit: effectiveLimit,
    offset: effectiveOffset,
  }), { headers: { 'Content-Type': 'application/json' } });
}

export async function syncProperty(env: Env, userId: string, propertyId: string): Promise<Response> {
  const request = new Request('https://internal/gsc/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // 'scheduled' lets the sync reuse a recent agg90 aggregate instead of
    // rebuilding it every cron run; the manual Sync button stays fully fresh.
    body: JSON.stringify({ property_id: propertyId, trigger: 'scheduled' }),
  });
  const response = await handleGSCSync(request, env, userId);
  if (!response.ok) {
    console.error(`GSC sync failed for property ${propertyId}: ${response.status}`);
  }
  return response;
}

// ---------------------------------------------------------------------------
// Dormant-account storage purge
// ---------------------------------------------------------------------------
// gsc_search_data is a CACHE of Google Search Analytics (Google retains ~16
// months upstream), so rows for accounts that stopped logging in are pure
// dead weight: nothing reads them (the daily cron already skips owners with
// no live session), but they hold gigabytes toward D1's 10 GB hard cap,
// which took the whole app down on 2026-06-25 when it was hit.
//
// Purge lifecycle:
// - A property is purge-eligible when its owner has created no session in
//   60 days (double the 30-day session lifetime), it has data
//   (last_synced_at set), and it was not already purged (purged_at NULL).
// - Purge chunk-deletes its gsc_search_data rows (one-shot DELETEs of large
//   properties blow D1's 30s statement cap, see handleGSCDisconnect), then
//   stamps purged_at and clears last_synced_at.
// - When the user returns: resyncPurgedProperties (fired from the
//   /gsc/properties dashboard load) re-syncs up to 3 purged properties in
//   the background, and the nightly cron picks up the rest (their new
//   session makes them eligible again). A successful sync clears purged_at.
// Interrupting mid-property is safe: rows only shrink, purged_at stays NULL,
// and the next run finishes the job.

const GSC_PURGE_DORMANT_AFTER = '-60 days';
export const GSC_PURGE_CHUNK = 10000;
const GSC_PURGE_MAX_PROPS_PER_RUN = 40;
// Bounds rows written per run (chunks * chunk size); the purge self-drains
// across runs of the 6h cron rather than spiking one invocation.
const GSC_PURGE_MAX_CHUNKS_PER_RUN = 150;
const GSC_PURGE_TIME_BUDGET_MS = 3 * 60 * 1000;

export async function purgeDormantGSCData(env: Env): Promise<{ properties: number; rows: number }> {
  const startedAt = Date.now();
  const candidates = await env.DB.prepare(
    `SELECT p.id FROM gsc_properties p
      WHERE p.kind = 'gsc'
        AND p.purged_at IS NULL
        AND p.last_synced_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM sessions s
           WHERE s.user_id = p.user_id
             AND s.created_at > datetime('now', ?)
        )
      LIMIT ?`
  ).bind(GSC_PURGE_DORMANT_AFTER, GSC_PURGE_MAX_PROPS_PER_RUN).all<{ id: string }>();

  let properties = 0;
  let rows = 0;
  let chunks = 0;
  for (const prop of candidates.results || []) {
    let complete = true;
    for (;;) {
      if (chunks >= GSC_PURGE_MAX_CHUNKS_PER_RUN || Date.now() - startedAt > GSC_PURGE_TIME_BUDGET_MS) {
        complete = false;
        break;
      }
      const res = await env.DB.prepare(
        `DELETE FROM gsc_search_data WHERE id IN (
           SELECT id FROM gsc_search_data WHERE property_id = ? LIMIT ?
         )`
      ).bind(prop.id, GSC_PURGE_CHUNK).run();
      chunks++;
      const changed = res.meta?.changes ?? 0;
      rows += changed;
      if (changed < GSC_PURGE_CHUNK) break;
    }
    if (!complete) break;
    await env.DB.prepare(
      `UPDATE gsc_properties SET purged_at = datetime('now'), last_synced_at = NULL WHERE id = ?`
    ).bind(prop.id).run();
    properties++;
  }
  return { properties, rows };
}

// ---------------------------------------------------------------------------
// One-time long-tail backlog purge
// ---------------------------------------------------------------------------
// The write-time filter (hasSignal) stops NEW zero-signal rows, but ~70% of
// the 29M rows already stored predate it, and at 9.06 GB of the 10 GB D1 cap
// there is no headroom to raise nightly sync capacity (bugs f7fa343f,
// 536e8205, b05f760e) until they are gone. Left alone they would age out via
// the agg90 weekly rebuild and the 35-day pd slide, but only for properties
// that still sync; this purge clears everything in days instead.
//
// Same shape as purgeDormantGSCData: chunked deletes under a time/chunk
// budget, self-draining across 6h-cron runs. Progress is a KV cursor of the
// last fully-purged property id; interrupting mid-property just re-purges an
// already-clean property (idempotent deletes). When the property walk
// completes, a done flag turns every future invocation into one KV read.
const GSC_LONGTAIL_CURSOR_KEY = 'gsc-longtail-purge-cursor';
const GSC_LONGTAIL_DONE_KEY = 'gsc-longtail-purge-done';
const GSC_LONGTAIL_PAUSED_KEY = 'gsc-longtail-purge-paused';
const GSC_LONGTAIL_MAX_CHUNKS_PER_RUN = 150;
const GSC_LONGTAIL_TIME_BUDGET_MS = 3 * 60 * 1000;
const GSC_LONGTAIL_PROPS_PAGE = 400;

export async function purgeLongTailGSCData(
  env: Env,
  opts?: { budgetMs?: number; maxChunks?: number },
): Promise<{ properties: number; rows: number; done: boolean }> {
  if (await env.KV.get(GSC_LONGTAIL_DONE_KEY) === '1') {
    return { properties: 0, rows: 0, done: true };
  }
  if (await env.KV.get(GSC_LONGTAIL_PAUSED_KEY) === '1') {
    return { properties: 0, rows: 0, done: false };
  }

  const startedAt = Date.now();
  const budgetMs = opts?.budgetMs ?? GSC_LONGTAIL_TIME_BUDGET_MS;
  const maxChunks = opts?.maxChunks ?? GSC_LONGTAIL_MAX_CHUNKS_PER_RUN;
  const cursor = (await env.KV.get(GSC_LONGTAIL_CURSOR_KEY)) ?? '';

  // Only properties that ever synced can hold rows. New properties are
  // written post-filter, so anything created after this purge started (id
  // ordering is random hex, not time) either has no rows or gets caught by
  // its own agg90/pd turnover.
  const page = await env.DB.prepare(
    `SELECT id FROM gsc_properties
      WHERE last_synced_at IS NOT NULL AND id > ?
      ORDER BY id LIMIT ${GSC_LONGTAIL_PROPS_PAGE}`
  ).bind(cursor).all<{ id: string }>();
  const candidates = page.results || [];

  let properties = 0;
  let rows = 0;
  let chunks = 0;
  let exhaustedList = candidates.length < GSC_LONGTAIL_PROPS_PAGE;

  // Workers KV allows about 1 write/sec to a single key. A stretch of
  // already-clean properties drains in one cheap DELETE each, so writing the
  // cursor after every property can exceed that rate and throw a 429 mid-run.
  // Keep the cursor in memory, flush it to KV at most once per second, and
  // always flush the final position once on exit below.
  let pendingCursor = cursor;
  let lastFlushedCursor = cursor;
  let lastCursorPutAt = startedAt;
  const CURSOR_PUT_INTERVAL_MS = 1000;

  for (const prop of candidates) {
    if (chunks >= maxChunks || Date.now() - startedAt > budgetMs) {
      exhaustedList = false;
      break;
    }
    let propDrained = false;
    while (chunks < maxChunks && Date.now() - startedAt <= budgetMs) {
      const res = await env.DB.prepare(
        `DELETE FROM gsc_search_data WHERE id IN (
           SELECT id FROM gsc_search_data
            WHERE property_id = ?
              AND clicks = 0 AND impressions <= ${GSC_LONGTAIL_MAX_IMPRESSIONS}
              AND query != '__daily_total__'
              AND (page IS NULL OR page != '__7d_query__')
            LIMIT ${GSC_PURGE_CHUNK}
         )`
      ).bind(prop.id).run();
      const deleted = res.meta?.changes ?? 0;
      rows += deleted;
      chunks += 1;
      if (deleted < GSC_PURGE_CHUNK) { propDrained = true; break; }
    }
    if (!propDrained) { exhaustedList = false; break; }
    properties += 1;
    pendingCursor = prop.id;
    const now = Date.now();
    if (now - lastCursorPutAt >= CURSOR_PUT_INTERVAL_MS) {
      await env.KV.put(GSC_LONGTAIL_CURSOR_KEY, pendingCursor);
      lastFlushedCursor = pendingCursor;
      lastCursorPutAt = now;
    }
  }

  const done = exhaustedList;
  if (done) await env.KV.put(GSC_LONGTAIL_DONE_KEY, '1');
  // Cursor only ever names a fully drained property, so a best-effort final
  // write is safe: if it fails, the next run just re-purges some already
  // clean properties (idempotent deletes), which is harmless.
  if (pendingCursor !== lastFlushedCursor) {
    try {
      await env.KV.put(GSC_LONGTAIL_CURSOR_KEY, pendingCursor);
    } catch (e) {
      console.error('gsc longtail purge final cursor put failed:', e);
    }
  }
  return { properties, rows, done };
}

// POST /api/admin/gsc/purge-long-tail { budgetMs?: number }
// Manual accelerated drain: the 6h cron alone takes ~3-4 days to clear the
// backlog; repeated calls here move that to hours when headroom is critical.
export async function handleAdminLongTailPurge(request: Request, env: Env, user: AuthUser): Promise<Response> {
  if (!isAdmin(user, env)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }
  let budgetMs = 20_000;
  try {
    const body = await request.json() as { budgetMs?: number };
    if (typeof body.budgetMs === 'number') budgetMs = Math.min(Math.max(body.budgetMs, 1_000), 25_000);
  } catch { /* empty body is fine */ }
  const result = await purgeLongTailGSCData(env, { budgetMs, maxChunks: 500 });
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
}

// Background repopulation for a returning user, fired (fire-and-forget) from
// the GET /gsc/properties dashboard load. Syncs up to 3 purged properties;
// the nightly cron covers any remainder now that the user has a live session.
// KV lock stops parallel page loads from stampeding duplicate syncs.
export async function resyncPurgedProperties(env: Env, userId: string): Promise<void> {
  try {
    const lockKey = `gsc_resync_purged:${userId}`;
    if (await env.KV.get(lockKey)) return;
    await env.KV.put(lockKey, '1', { expirationTtl: 300 });
    const props = await env.DB.prepare(
      `SELECT id FROM gsc_properties
        WHERE user_id = ? AND kind = 'gsc' AND is_enabled = 1 AND purged_at IS NOT NULL
        LIMIT 3`
    ).bind(userId).all<{ id: string }>();
    for (const p of props.results || []) {
      const res = await syncProperty(env, userId, p.id);
      if (res.ok) {
        const body = await res.json().catch(() => null) as { mode?: string } | null;
        if (body?.mode === 'skipped') {
          // Google returned no Search Analytics data, so there is nothing to
          // restore. handleGSCSync bails before its success UPDATE in that
          // case, which would leave purged_at set and re-fire this futile
          // full sync on every dashboard load. Clear the marker; the nightly
          // cron still retries the property normally.
          await env.DB.prepare(
            'UPDATE gsc_properties SET purged_at = NULL WHERE id = ?'
          ).bind(p.id).run();
        }
      }
    }
  } catch (err) {
    console.error('resyncPurgedProperties failed:', err);
  }
}

// GET /gsc/sitemaps?property_id=xxx
// Returns a compact page visibility summary for the dashboard. This endpoint
// currently uses Search Analytics rows, not GSC Page Indexing / URL Inspection
// coverage, so it must not present the result as full indexation coverage.
export async function handleGSCSitemaps(request: Request, env: Env, userId: string): Promise<Response> {
  const url = new URL(request.url);
  const propertyId = url.searchParams.get('property_id');
  if (!propertyId) {
    return new Response(JSON.stringify({ error: 'property_id required' }), { status: 400 });
  }

  const property = await env.DB.prepare(
    'SELECT id, kind, site_url, last_synced_at FROM gsc_properties WHERE id = ? AND user_id = ?'
  ).bind(propertyId, userId).first();
  if (!property) {
    return new Response(JSON.stringify({ error: 'Property not found' }), { status: 404 });
  }
  if (property.kind === 'manual') {
    return new Response(JSON.stringify({
      status: 'manual_property',
      message: 'Manual properties do not have Google Search Console indexation data.',
      total: 0,
      indexed: 0,
      search_visible_pages: 0,
      not_indexed: 0,
      indexed_pct: 0,
    }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (property.kind !== 'gsc') {
    return new Response(JSON.stringify({
      status: 'sitemap_unavailable',
      message: 'Search Console page visibility is only available for Google Search Console properties.',
      total: 0,
      indexed: 0,
      search_visible_pages: 0,
      not_indexed: 0,
      indexed_pct: 0,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  const pageCount = await env.DB.prepare(`
    SELECT COUNT(DISTINCT page) as count
    FROM gsc_search_data
    WHERE property_id = ?
      AND page IS NOT NULL
      AND (source = 'agg90' OR source = 'gsc')
      AND query != '__daily_total__' AND page != '__7d_query__'
  `).bind(propertyId).first();

  const indexed = Number(pageCount?.count || 0);
  if (!property.last_synced_at || indexed === 0) {
    return new Response(JSON.stringify({
      status: property.last_synced_at ? 'no_page_data' : 'needs_sync',
      message: property.last_synced_at
        ? 'No page-level Search Console data is available for this property yet.'
        : 'Sync this property to load Search Console page data.',
      total: indexed,
      indexed,
      search_visible_pages: indexed,
      not_indexed: 0,
      indexed_pct: indexed > 0 ? 100 : 0,
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    status: 'search_analytics_only',
    message: 'Pages that have appeared in Google Search Analytics after sync. This is not the same as GSC Page Indexing coverage.',
    total: indexed,
    indexed,
    search_visible_pages: indexed,
    not_indexed: 0,
    indexed_pct: 100,
  }), { headers: { 'Content-Type': 'application/json' } });
}

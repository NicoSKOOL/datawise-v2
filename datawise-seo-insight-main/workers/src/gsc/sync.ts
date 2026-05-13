import type { Env } from '../index';
import { refreshGSCToken } from './oauth';

interface SearchAnalyticsRow {
  keys: string[]; // [date, query, page]
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

// POST /gsc/sync - Fetch Search Analytics data for a property
export async function handleGSCSync(request: Request, env: Env, userId: string): Promise<Response> {
  const { property_id } = await request.json() as { property_id: string };
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
    return new Response(JSON.stringify({ error: 'GSC not connected or token expired. Please reconnect.' }), { status: 403 });
  }

  const siteUrl = property.site_url as string;
  const formatDate = (d: Date) => d.toISOString().split('T')[0];
  const apiUrl = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  const now = new Date();
  const ninetyDaysAgo = new Date(now);
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

  // --- Pass 1: Daily totals (dimensions: ['date']) ---
  // ~90 rows, never truncated, gives accurate daily click/impression totals
  const dailyResponse = await fetch(apiUrl, {
    method: 'POST', headers,
    body: JSON.stringify({
      startDate: formatDate(ninetyDaysAgo),
      endDate: formatDate(now),
      dimensions: ['date'],
      rowLimit: 25000,
      dataState: 'final',
    }),
  });

  if (!dailyResponse.ok) {
    const errorBody = await dailyResponse.text();
    console.error('GSC daily totals API error:', errorBody);
    return new Response(JSON.stringify({ error: 'Failed to fetch GSC data' }), { status: 500 });
  }

  const dailyData = await dailyResponse.json() as { rows?: SearchAnalyticsRow[] };
  const dailyRows = dailyData.rows || [];

  // --- Pass 2: Query+page data per 30-day batch (dimensions: ['query', 'page']) ---
  // Each batch gets its own 25K row budget for query-level detail
  const queryRows: { date: string; row: SearchAnalyticsRow }[] = [];
  for (let i = 0; i < 3; i++) {
    const batchEnd = new Date(now);
    batchEnd.setDate(batchEnd.getDate() - (i * 30));
    const batchStart = new Date(batchEnd);
    batchStart.setDate(batchStart.getDate() - 30);

    const apiResponse = await fetch(apiUrl, {
      method: 'POST', headers,
      body: JSON.stringify({
        startDate: formatDate(batchStart),
        endDate: formatDate(batchEnd),
        dimensions: ['query', 'page'],
        rowLimit: 25000,
        dataState: 'final',
      }),
    });

    if (!apiResponse.ok) {
      const errorBody = await apiResponse.text();
      console.error('GSC query batch API error:', errorBody);
      return new Response(JSON.stringify({ error: 'Failed to fetch GSC data' }), { status: 500 });
    }

    const data = await apiResponse.json() as { rows?: SearchAnalyticsRow[] };
    // Store batch end date so we can filter by time period later
    const batchDate = formatDate(batchEnd);
    for (const row of data.rows || []) {
      queryRows.push({ date: batchDate, row });
    }
  }

  // --- Pass 3: 7-day query breakdown (dimensions: ['query']) ---
  // Separate call for recent query-level data the user asks about most
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const recent7dResponse = await fetch(apiUrl, {
    method: 'POST', headers,
    body: JSON.stringify({
      startDate: formatDate(sevenDaysAgo),
      endDate: formatDate(now),
      dimensions: ['query'],
      rowLimit: 25000,
      dataState: 'final',
    }),
  });

  let query7dRows: SearchAnalyticsRow[] = [];
  if (recent7dResponse.ok) {
    const data = await recent7dResponse.json() as { rows?: SearchAnalyticsRow[] };
    query7dRows = data.rows || [];
  }

  // Clear old data for this property
  await env.DB.prepare('DELETE FROM gsc_search_data WHERE property_id = ?').bind(property_id).run();

  // Insert daily totals (query = '__daily_total__' to distinguish from query-level rows)
  const insertBatchSize = 100;
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

  // Insert query+page rows from 30-day batches
  for (let i = 0; i < queryRows.length; i += insertBatchSize) {
    const batch = queryRows.slice(i, i + insertBatchSize);
    const stmts = batch.map(({ date, row }) =>
      env.DB.prepare(
        'INSERT INTO gsc_search_data (property_id, date, query, page, clicks, impressions, ctr, position, device, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(property_id, date, row.keys[0], row.keys[1], row.clicks, row.impressions, row.ctr, row.position, null, null)
    );
    await env.DB.batch(stmts);
  }

  // Update last_synced_at
  await env.DB.prepare(
    'UPDATE gsc_properties SET last_synced_at = datetime("now") WHERE id = ?'
  ).bind(property_id).run();

  const totalRows = dailyRows.length + query7dRows.length + queryRows.length;
  return new Response(JSON.stringify({
    success: true,
    rows_synced: totalRows,
    daily_rows: dailyRows.length,
    query_7d_rows: query7dRows.length,
    query_30d_rows: queryRows.length,
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
      WHERE property_id = ? AND query != '__daily_total__' AND page != '__7d_query__'
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
    FROM gsc_search_data WHERE property_id = ? AND query != '__daily_total__' AND page != '__7d_query__'
    GROUP BY query ORDER BY clicks DESC LIMIT 50
  `).bind(propertyId).all();

  // Top pages by clicks
  const topPages = await env.DB.prepare(`
    SELECT page, SUM(clicks) as clicks, SUM(impressions) as impressions,
           ROUND(AVG(position), 1) as avg_position
    FROM gsc_search_data WHERE property_id = ? AND query != '__daily_total__' AND page != '__7d_query__'
    GROUP BY page ORDER BY clicks DESC LIMIT 30
  `).bind(propertyId).all();

  // Opportunity keywords
  const opportunities = await env.DB.prepare(`
    SELECT query, SUM(clicks) as clicks, SUM(impressions) as impressions,
           ROUND(AVG(position), 1) as avg_position, ROUND(AVG(ctr), 4) as avg_ctr
    FROM gsc_search_data WHERE property_id = ? AND query != '__daily_total__' AND page != '__7d_query__'
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

  return new Response(JSON.stringify({
    property: property.site_url,
    last_synced: property.last_synced_at,
    daily_trend: dailyTrend.results || [],
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
  }), { headers: { 'Content-Type': 'application/json' } });
}

// GET /gsc/queries?property_id=xxx&filter=all|top10|page2|opportunities&search=...&sort=clicks&order=desc&limit=100&offset=0
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

  const baseWhere = `property_id = ? AND query != '__daily_total__' AND page != '__7d_query__'`;

  // "page2" groups by page URL; everything else groups by query
  if (filter === 'page2') {
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

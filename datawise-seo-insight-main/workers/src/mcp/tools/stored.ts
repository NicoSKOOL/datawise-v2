import { z } from 'zod';
import { defineTool, localeInputs, shapeFor } from './types';
import { callJson, readJson, HandlerError } from '../call-handler';
import { asWorkerEnv } from '../env';
import { toolResult, toolError, compact } from '../shape';
import { handleListProjects, handleListKeywords, handleKeywordHistory } from '../../routes/rank-tracking';
import { handleGetAITracking, handleAIReport } from '../../routes/ai-tracking';
import { handleReviews, handleGBPProfile } from '../../routes/local-seo';
import { handleGSCProperties } from '../../gsc/oauth';
import { handleGSCData, handleGSCQueries } from '../../gsc/sync';

const responseFormat = localeInputs.response_format;

function pick<T extends Record<string, unknown>>(row: T, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (row[k] !== undefined) out[k] = row[k];
  return out;
}

// Turns a handler's 404 / 400 into an isError result the model can act on
// instead of an exception the gate reports as an internal error.
async function guarded(run: () => Promise<ReturnType<typeof toolResult>>) {
  try {
    return await run();
  } catch (err) {
    if (err instanceof HandlerError && err.status < 500) return toolError(err.message);
    throw err;
  }
}

function getRequest(path: string, params: Record<string, string | number | undefined>): Request {
  const url = new URL(`https://mcp.internal${path}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  return new Request(url.toString(), { method: 'GET' });
}

const PROJECT_FIELDS = ['id', 'name', 'domain', 'project_type', 'location_code', 'language_code', 'keyword_count', 'ranking_keywords', 'avg_position', 'last_checked_at'];
const KEYWORD_FIELDS = ['id', 'keyword', 'position', 'prev_position', 'estimated_traffic', 'checked_at', 'target_url', 'location_code'];

export const rankTracking = defineTool({
  name: 'datawise_rank_tracking',
  description:
    'Use this to read the member\'s own DataWise rank tracking data (no DataForSEO cost). action=list_projects lists tracked projects with keyword counts and average position; action=project_keywords lists a project\'s keywords with current and previous position; action=keyword_history returns the last 30 checks for one keyword. ' +
    'Use response_format=detailed on list_projects to see every project column, including any place id for local projects. Do not use to research new keywords.',
  inputSchema: z.object({
    action: z.enum(['list_projects', 'project_keywords', 'keyword_history']),
    project_id: z.string().min(1).optional().describe('Required for project_keywords. From list_projects.'),
    keyword_id: z.string().min(1).optional().describe('Required for keyword_history. From project_keywords.'),
    response_format: responseFormat,
  }).refine((a) => a.action !== 'project_keywords' || a.project_id, { message: 'project_id is required for project_keywords' })
    .refine((a) => a.action !== 'keyword_history' || a.keyword_id, { message: 'keyword_id is required for keyword_history' }),
  async run(args, ctx) {
    const env = asWorkerEnv(ctx.env);
    const uid = ctx.identity.userId;
    const shape = shapeFor(args.response_format);
    return guarded(async () => {
      if (args.action === 'list_projects') {
        const rows = await readJson<any[]>(await handleListProjects(env, uid));
        const projects = rows.map((r) => (args.response_format === 'detailed' ? compact(r, shape) : pick(r, PROJECT_FIELDS)));
        return toolResult({ projects }, `${projects.length} rank tracking projects.`);
      }
      if (args.action === 'project_keywords') {
        const rows = await readJson<any[]>(await handleListKeywords(env, uid, args.project_id!));
        const keywords = rows.map((r) => (args.response_format === 'detailed' ? compact(r, shape) : pick(r, KEYWORD_FIELDS)));
        return toolResult({ project_id: args.project_id, keywords }, `${keywords.length} tracked keywords in project ${args.project_id}.`);
      }
      const data = await readJson<any>(await handleKeywordHistory(env, uid, args.keyword_id!));
      const history = compact(data.history ?? [], shape);
      return toolResult({ keyword: data.keyword, history: history as Record<string, unknown>[] }, `${(history as unknown[]).length} checks for "${data.keyword?.keyword}".`);
    });
  },
});

export const aiVisibility = defineTool({
  name: 'datawise_ai_visibility',
  description:
    'Use this to read the member\'s AI Visibility tracker for a rank tracking project (no DataForSEO cost): a per-engine trend of how many tracked queries cited or mentioned the site, share of voice by domain, and optionally the tracked queries with their latest result per engine. ' +
    'Do not use for live AI mention counts on arbitrary domains (datawise_ai_mentions).',
  inputSchema: z.object({
    project_id: z.string().min(1).describe('From datawise_rank_tracking list_projects.'),
    period: z.number().int().min(7).max(365).default(90).describe('Days of history for the trend.'),
    include_queries: z.boolean().default(false),
    response_format: responseFormat,
  }),
  async run(args, ctx) {
    const env = asWorkerEnv(ctx.env);
    const uid = ctx.identity.userId;
    const shape = shapeFor(args.response_format);
    return guarded(async () => {
      const report = await readJson<any>(await handleAIReport(getRequest('/report', { period: args.period }), env, uid, args.project_id));
      const out: Record<string, unknown> = {
        project_id: args.project_id,
        period: report.period ?? args.period,
        trend: compact(report.trend ?? [], shape),
        share_of_voice: compact(report.share_of_voice ?? [], shape),
      };
      if (args.include_queries) {
        const tracking = await readJson<any>(await handleGetAITracking(env, uid, args.project_id));
        out.queries = compact(tracking.queries ?? tracking, shape);
      }
      return toolResult(out, `AI visibility for project ${args.project_id} over ${out.period} days.`);
    });
  },
});

export const localReviews = defineTool({
  name: 'datawise_local_reviews',
  description:
    'Use this for a Google Business Profile: the profile summary (name, rating, category) and its most recent reviews with text. Identify the business by place_id (preferred) or business_name. Pass project_id for a DataWise local project to also get 30/60-day rating trends. ' +
    'Reviews are cached for an hour. Do not use for organic keywords.',
  inputSchema: z.object({
    place_id: z.string().min(1).optional().describe('Google place id, e.g. ChIJ...'),
    business_name: z.string().min(1).max(200).optional().describe('Business name plus city if no place_id, e.g. "Acme Plumbing Austin".'),
    project_id: z.string().min(1).optional().describe('DataWise local project id, for trend tiles.'),
    limit: z.number().int().min(1).max(100).default(20).describe('Reviews to fetch (newest first).'),
    ...localeInputs,
  }).refine((a) => a.place_id || a.business_name, { message: 'place_id or business_name is required' }),
  async run(args, ctx) {
    const uid = ctx.identity.userId;
    const shape = shapeFor(args.response_format);
    const ident = args.place_id ? { place_id: args.place_id } : { business_name: args.business_name };
    const locale = { location_code: args.location_code ?? ctx.identity.defaultLocationCode, language_code: args.language_code ?? ctx.identity.defaultLanguageCode };
    return guarded(async () => {
      const [profile, reviews] = await Promise.all([
        callJson(ctx.env, uid, handleGBPProfile, { ...ident, ...locale }).catch((err) => ({ error: err instanceof Error ? err.message : String(err) })),
        callJson(ctx.env, uid, handleReviews, { ...ident, ...locale, project_id: args.project_id, depth: args.limit, sort_by: 'newest' }),
      ]);
      return toolResult(
        { ...ident, profile: compact(profile, shape) as Record<string, unknown>, reviews: compact(reviews, shape) as Record<string, unknown> },
        `Profile and up to ${args.limit} reviews for ${args.place_id ?? args.business_name}.`,
      );
    });
  },
});

export const searchConsole = defineTool({
  name: 'datawise_search_console',
  description:
    'Use this to read the member\'s connected Google Search Console data stored in DataWise (no DataForSEO cost). action=list_properties shows connected properties and their ids; action=overview returns the dashboard totals and trends for a property; action=queries lists queries with clicks, impressions, CTR and position, optionally filtered by a search string. ' +
    'Do not use for competitors or third-party domains.',
  inputSchema: z.object({
    action: z.enum(['list_properties', 'overview', 'queries']),
    property_id: z.string().min(1).optional().describe('Required for overview and queries. From list_properties.'),
    range: z.string().max(10).optional().describe('Date range token accepted by the DataWise dashboard, e.g. 28d or 3m. Omit for the default.'),
    search: z.string().max(200).optional().describe('queries only: keep queries containing this text.'),
    sort: z.enum(['clicks', 'impressions', 'ctr', 'position']).default('clicks'),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
    response_format: responseFormat,
  }).refine((a) => a.action === 'list_properties' || a.property_id, { message: 'property_id is required for overview and queries' }),
  async run(args, ctx) {
    const env = asWorkerEnv(ctx.env);
    const uid = ctx.identity.userId;
    const shape = shapeFor(args.response_format);
    return guarded(async () => {
      if (args.action === 'list_properties') {
        const data = await readJson<any>(await handleGSCProperties(env, uid));
        const properties = (data.properties ?? []).map((p: any) => pick(p, ['id', 'site_url', 'kind', 'last_synced_at', 'is_enabled', 'data_missing']));
        return toolResult({ connected: Boolean(data.connected), needs_reconnect: Boolean(data.needs_reconnect), properties }, `${properties.length} Search Console properties.`);
      }
      if (args.action === 'overview') {
        const data = await readJson<any>(await handleGSCData(getRequest('/gsc/data', { property_id: args.property_id, range: args.range }), env, uid));
        return toolResult({ property_id: args.property_id, range: args.range ?? 'default', overview: compact(data, shape) as Record<string, unknown> }, `Search Console overview for property ${args.property_id}.`);
      }
      const data = await readJson<any>(await handleGSCQueries(
        getRequest('/gsc/queries', { property_id: args.property_id, search: args.search, sort: args.sort, order: 'desc', limit: args.limit, offset: args.offset }), env, uid));
      return toolResult({ property_id: args.property_id, queries: compact(data, { ...shape, maxArray: args.limit }) as Record<string, unknown> }, `Search Console queries for property ${args.property_id}.`);
    });
  },
});

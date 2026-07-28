import type { Env } from './index';
import type { AuthUser } from './auth/google';

export type ActivityCategory = 'product' | 'admin' | 'security' | 'auth';
export type ActivityOutcome = 'success' | 'blocked' | 'error';

export interface ActivityClassification {
  event_name: string;
  event_category: ActivityCategory;
  feature: string;
  action: string;
  resource_type?: string;
  resource_id?: string;
}

interface ActivityRoute {
  pattern: RegExp;
  methods?: string[];
  classify: (match: RegExpMatchArray, method: string) => ActivityClassification | null;
}

interface RecordRequestOptions {
  creditCost?: number;
  errorCode?: string | null;
}

type MetadataValue = string | number | boolean;
type SanitizedMetadata = Record<string, MetadataValue>;

const MAX_METADATA_KEYS = 24;
const MAX_METADATA_STRING = 512;
const SENSITIVE_METADATA_KEY =
  /token|secret|password|authorization|cookie|prompt|message|content|html|markdown|body|credential|api_key|private_key/i;

const ignoredRoutes: ActivityRoute[] = [
  { pattern: /^\/auth\/me$/, classify: () => null },
  { pattern: /^\/health$/, classify: () => null },
  { pattern: /^\/api\/track\/pageview$/, classify: () => null },
  { pattern: /^\/api\/admin\/activity(?:\/.*)?$/, classify: () => null },
];

const routes: ActivityRoute[] = [
  {
    pattern: /^\/auth\/logout$/,
    methods: ['POST'],
    classify: () => ({
      event_name: 'User Logged Out',
      event_category: 'auth',
      feature: 'auth',
      action: 'logout',
      resource_type: 'session',
    }),
  },
  {
    pattern: /^\/auth\/defaults$/,
    methods: ['PATCH'],
    classify: () => ({
      event_name: 'User Defaults Updated',
      event_category: 'product',
      feature: 'settings',
      action: 'update_defaults',
      resource_type: 'user_settings',
    }),
  },
  {
    pattern: /^\/api\/admin\/delete-user$/,
    methods: ['POST'],
    classify: () => ({
      event_name: 'Admin User Deleted',
      event_category: 'admin',
      feature: 'admin',
      action: 'delete_user',
      resource_type: 'user',
    }),
  },
  {
    pattern: /^\/api\/admin\/feedback\/([^/]+)$/,
    methods: ['PATCH', 'DELETE'],
    classify: (match, method) => ({
      event_name: method === 'DELETE' ? 'Admin Feedback Deleted' : 'Admin Feedback Updated',
      event_category: 'admin',
      feature: 'admin',
      action: method === 'DELETE' ? 'delete_feedback' : 'update_feedback',
      resource_type: 'feedback',
      resource_id: match[1],
    }),
  },
  {
    pattern: /^\/api\/admin\/upload-members$/,
    methods: ['POST'],
    classify: () => adminEvent('Admin Members Uploaded', 'upload_members', 'member_list'),
  },
  {
    pattern: /^\/api\/admin\/revoke-access$/,
    methods: ['POST'],
    classify: () => adminEvent('Admin Access Changed', 'change_access', 'user'),
  },
  {
    pattern: /^\/api\/admin\/toggle-member$/,
    methods: ['POST'],
    classify: () => adminEvent('Admin Member Toggled', 'toggle_member', 'user'),
  },
  {
    pattern: /^\/api\/admin\/add-member$/,
    methods: ['POST'],
    classify: () => adminEvent('Admin Member Added', 'add_member', 'user'),
  },
  {
    pattern: /^\/api\/admin\/send-invites$/,
    methods: ['POST'],
    classify: () => adminEvent('Admin Invites Sent', 'send_invites', 'invite'),
  },
  {
    pattern: /^\/api\/admin\/promo-codes(?:\/([^/]+))?(?:\/redemptions)?$/,
    methods: ['POST', 'PATCH'],
    classify: (match, method) => ({
      event_name: method === 'POST' ? 'Admin Promo Code Created' : 'Admin Promo Code Toggled',
      event_category: 'admin',
      feature: 'admin',
      action: method === 'POST' ? 'create_promo_code' : 'toggle_promo_code',
      resource_type: 'promo_code',
      resource_id: match[1],
    }),
  },
  {
    pattern: /^\/api\/admin\/content-writer-prompts\/([^/]+)\/(draft|publish|reset)$/,
    methods: ['PUT', 'POST'],
    classify: (match) => ({
      event_name: `Admin Writer Prompt ${titleCase(match[2])}`,
      event_category: 'admin',
      feature: 'admin',
      action: `${match[2]}_writer_prompt`,
      resource_type: 'writer_prompt',
      resource_id: decodeURIComponent(match[1]),
    }),
  },
  {
    pattern: /^\/api\/admin(?:\/.*)?$/,
    classify: () => adminEvent('Admin API Used', 'use_admin_api', 'admin_endpoint'),
  },
  {
    pattern: /^\/api\/keywords\/[^/]+$/,
    methods: ['POST'],
    classify: () => ({
      event_name: 'Keyword Research Ran',
      event_category: 'product',
      feature: 'keyword_research',
      action: 'run',
      resource_type: 'keyword',
    }),
  },
  {
    pattern: /^\/api\/competitors\/[^/]+$/,
    methods: ['POST'],
    classify: () => productEvent('Competitor Analysis Ran', 'competitor_analysis', 'run', 'domain'),
  },
  {
    pattern: /^\/api\/ai\/[^/]+$/,
    methods: ['POST', 'GET'],
    classify: () => productEvent('AI Visibility Used', 'ai_visibility', 'run', 'query'),
  },
  {
    pattern: /^\/api\/llm-mentions\/[^/]+$/,
    methods: ['POST'],
    classify: () => productEvent('LLM Mentions Queried', 'ai_visibility', 'query', 'query'),
  },
  {
    pattern: /^\/api\/backlinks\/[^/]+$/,
    methods: ['POST'],
    classify: () => productEvent('Backlinks Queried', 'backlinks', 'query', 'domain'),
  },
  {
    pattern: /^\/api\/rank-tracking\/projects\/([^/]+)\/check$/,
    methods: ['POST'],
    classify: (match) => productEvent('Rank Tracking Checked', 'rank_tracking', 'check_rankings', 'project', match[1]),
  },
  {
    pattern: /^\/api\/rank-tracking\/projects(?:\/([^/]+))?(?:\/keywords|\/report)?$/,
    classify: (match, method) => productEvent(routeEventName('Rank Tracking', method), 'rank_tracking', actionForMethod(method), 'project', match[1]),
  },
  {
    pattern: /^\/api\/rank-tracking\/keywords\/([^/]+)(?:\/history)?$/,
    classify: (match, method) => productEvent(routeEventName('Rank Keyword', method), 'rank_tracking', actionForMethod(method), 'keyword', match[1]),
  },
  {
    pattern: /^\/api\/local-seo\/.*$/,
    classify: () => productEvent('Local SEO Used', 'local_seo', 'use', 'local_project'),
  },
  {
    pattern: /^\/api\/planner\/.*$/,
    classify: () => productEvent('Content Planner Used', 'content_planner', 'use', 'planner_item'),
  },
  {
    pattern: /^\/api\/content-writer\/posts\/([^/]+)\/step$/,
    methods: ['POST'],
    classify: (match) => productEvent('Content Writer Step Ran', 'content_writer', 'run_step', 'post', match[1]),
  },
  {
    pattern: /^\/api\/content-writer\/.*$/,
    classify: () => productEvent('Content Writer Used', 'content_writer', 'use', 'content_workspace'),
  },
  {
    pattern: /^\/api\/content-tools\/.*$/,
    classify: () => productEvent('Content Tool Used', 'content_tools', 'use', 'content_url'),
  },
  {
    pattern: /^\/api\/site-audit\/audits(?:\/([^/]+))?$/,
    classify: (match, method) => productEvent(routeEventName('Site Audit', method), 'site_audit', actionForMethod(method), 'audit', match[1]),
  },
  {
    pattern: /^\/api\/site-audit\/.*$/,
    classify: () => productEvent('Site Audit Used', 'site_audit', 'use', 'audit'),
  },
  {
    pattern: /^\/chat$/,
    methods: ['POST'],
    classify: () => productEvent('SEO Assistant Messaged', 'seo_assistant', 'send_message', 'conversation'),
  },
  {
    pattern: /^\/chat\/conversations(?:\/([^/]+))?$/,
    classify: (match, method) => productEvent(routeEventName('SEO Assistant Conversation', method), 'seo_assistant', actionForMethod(method), 'conversation', match[1]),
  },
  {
    pattern: /^\/gsc\/(connect|disconnect|sync|properties|data|queries|sitemaps)(?:\/([^/]+))?$/,
    classify: (match, method) => productEvent(routeEventName('Search Console', method), 'integrations', match[1], 'property', match[2]),
  },
  {
    pattern: /^\/bwt\/(connect|disconnect|properties)(?:\/([^/]+))?$/,
    classify: (match, method) => productEvent(routeEventName('Bing Webmaster Tools', method), 'integrations', match[1], 'property', match[2]),
  },
  {
    pattern: /^\/api\/properties\/manual(?:\/([^/]+))?$/,
    classify: (match, method) => productEvent(routeEventName('Manual Property', method), 'integrations', actionForMethod(method), 'property', match[1]),
  },
  {
    pattern: /^\/api\/feedback(?:\/.*)?$/,
    classify: () => productEvent('Feedback Used', 'feedback', 'use', 'feedback'),
  },
  {
    pattern: /^\/api\/promo\/redeem$/,
    methods: ['POST'],
    classify: () => productEvent('Promo Redeemed', 'promo', 'redeem', 'promo_code'),
  },
  {
    pattern: /^\/api\/citations\/.*$/,
    classify: () => productEvent('Citations Used', 'local_seo', 'use_citations', 'citation'),
  },
];

export function classifyActivity(path: string, method: string): ActivityClassification | null {
  const normalizedMethod = method.toUpperCase();
  for (const route of ignoredRoutes) {
    const match = path.match(route.pattern);
    if (match && methodAllowed(route, normalizedMethod)) return null;
  }

  for (const route of routes) {
    const match = path.match(route.pattern);
    if (!match || !methodAllowed(route, normalizedMethod)) continue;
    return route.classify(match, normalizedMethod);
  }

  return null;
}

export function sanitizeActivityMetadata(input: unknown): SanitizedMetadata {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: SanitizedMetadata = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_METADATA_KEYS) break;
    if (SENSITIVE_METADATA_KEY.test(key)) continue;
    if (value == null) continue;

    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) continue;
      out[key] = trimmed.slice(0, MAX_METADATA_STRING);
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

// Internal response header carrying a handler-supplied error code to the
// activity logger. Stripped in index.ts before the response leaves the Worker.
export const ACTIVITY_ERROR_CODE_HEADER = 'X-DataWise-Error-Code';

export function retentionDaysForCategory(category: ActivityCategory): number {
  return category === 'product' ? 90 : 365;
}

export async function recordRequestActivity(
  env: Env,
  request: Request,
  user: AuthUser,
  response: Response,
  startedAtMs: number,
  options: RecordRequestOptions = {},
): Promise<void> {
  try {
    const url = new URL(request.url);
    const classification = classifyActivity(url.pathname, request.method);
    if (!classification) return;

    const durationMs = Math.max(0, Date.now() - startedAtMs);
    const statusCode = response.status;
    const outcome: ActivityOutcome = statusCode >= 500 ? 'error' : statusCode >= 400 ? 'blocked' : 'success';
    const category: ActivityCategory =
      statusCode === 403 && classification.event_category === 'admin'
        ? 'security'
        : classification.event_category;
    const metadata = sanitizeActivityMetadata({
      route_template: templatePath(url.pathname),
      query_keys: Array.from(url.searchParams.keys()).sort().join(','),
      cf_ray: request.headers.get('CF-Ray') || undefined,
    });

    await recordActivity(env, {
      ...classification,
      event_category: category,
      user_id: user.id,
      session_id: request.headers.get('X-DataWise-Session-Id') || null,
      request_id: crypto.randomUUID(),
      route: url.pathname,
      method: request.method.toUpperCase(),
      status_code: statusCode,
      outcome,
      property_id: url.searchParams.get('property_id'),
      credit_cost: outcome === 'success' ? options.creditCost ?? 0 : 0,
      duration_ms: durationMs,
      // ACTIVITY_ERROR_CODE_HEADER lets any handler attribute a failure without
      // threading options through the single generic addCors wrapper. Until it
      // existed every 5xx logged error_code = NULL, which is why four days of
      // /gsc/sync failures (bug 536e8205) could not be diagnosed from D1 at all
      // and the real upstream reason only ever reached console.error.
      error_code:
        options.errorCode
        || response.headers.get(ACTIVITY_ERROR_CODE_HEADER)
        || (outcome === 'blocked' ? `http_${statusCode}` : null),
      metadata_json: Object.keys(metadata).length ? JSON.stringify(metadata) : null,
    });
  } catch (err) {
    console.error('recordRequestActivity failed:', err);
  }
}

export async function pruneAppEvents(env: Env): Promise<{ deleted: number }> {
  const product = await env.DB.prepare(
    "DELETE FROM app_events WHERE event_category = 'product' AND created_at < datetime('now', '-90 days')"
  ).run();
  const audit = await env.DB.prepare(
    "DELETE FROM app_events WHERE event_category != 'product' AND created_at < datetime('now', '-365 days')"
  ).run();
  return {
    deleted: (product.meta?.changes ?? 0) + (audit.meta?.changes ?? 0),
  };
}

interface InsertActivityInput extends ActivityClassification {
  user_id: string;
  session_id?: string | null;
  request_id?: string | null;
  route?: string | null;
  method?: string | null;
  status_code?: number | null;
  outcome?: ActivityOutcome | null;
  property_id?: string | null;
  credit_cost?: number | null;
  duration_ms?: number | null;
  error_code?: string | null;
  metadata_json?: string | null;
}

async function recordActivity(env: Env, input: InsertActivityInput): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO app_events (
      id, event_name, event_category, user_id, session_id, request_id,
      feature, action, route, method, status_code, outcome, resource_type,
      resource_id, property_id, credit_cost, duration_ms, error_code, metadata_json
    )
    VALUES (lower(hex(randomblob(16))), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    input.event_name,
    input.event_category,
    input.user_id,
    input.session_id || null,
    input.request_id || null,
    input.feature,
    input.action,
    input.route || null,
    input.method || null,
    input.status_code ?? null,
    input.outcome || null,
    input.resource_type || null,
    input.resource_id || null,
    input.property_id || null,
    input.credit_cost ?? 0,
    input.duration_ms ?? null,
    input.error_code || null,
    input.metadata_json || null,
  ).run();
}

function methodAllowed(route: ActivityRoute, method: string): boolean {
  return !route.methods || route.methods.includes(method);
}

function adminEvent(eventName: string, action: string, resourceType: string): ActivityClassification {
  return {
    event_name: eventName,
    event_category: 'admin',
    feature: 'admin',
    action,
    resource_type: resourceType,
  };
}

function productEvent(
  eventName: string,
  feature: string,
  action: string,
  resourceType: string,
  resourceId?: string,
): ActivityClassification {
  return {
    event_name: eventName,
    event_category: 'product',
    feature,
    action,
    resource_type: resourceType,
    resource_id: resourceId,
  };
}

function routeEventName(prefix: string, method: string): string {
  if (method === 'POST') return `${prefix} Created`;
  if (method === 'PATCH' || method === 'PUT') return `${prefix} Updated`;
  if (method === 'DELETE') return `${prefix} Deleted`;
  return `${prefix} Viewed`;
}

function actionForMethod(method: string): string {
  if (method === 'POST') return 'create';
  if (method === 'PATCH' || method === 'PUT') return 'update';
  if (method === 'DELETE') return 'delete';
  return 'view';
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function templatePath(path: string): string {
  return path
    .split('/')
    .map((part) => {
      if (/^[a-f0-9]{16,}$/i.test(part)) return ':id';
      if (/^[a-z0-9_-]{20,}$/i.test(part)) return ':id';
      return part;
    })
    .join('/');
}

// Shared canned DataForSEO catalog-endpoint responses + a global fetch stub
// serving them. resolve_market (Task 8, providers/dataforseo/catalogs.ts) is
// the first real stage handler that makes live DataForSEO GETs from inside
// the orchestration loop, so every orchestration/e2e test that drives a run
// through resolve_market without overriding it needs this stub -- otherwise
// the stage handler calls the real global fetch and the test becomes
// network-dependent and non-deterministic.
//
// The default fixtures cover 'US'/'en' plus the "Austin"/"Round Rock" cities
// used by process-run.test.ts's and acceptance.e2e.test.ts's sample briefs.
//
// Task 10 adds collect_keyword_evidence as the second real stage handler in
// this same full-drive path, making live DataForSEO Labs POST calls
// (keyword_ideas/keyword_suggestions/keywords_for_site/keyword_overview/
// bulk_keyword_difficulty). This stub covers all five with empty-item
// responses: every full-drive test here cares about stage-ordering and
// terminal-status behavior, not real keyword content, and an empty universe
// still exercises the handler's user-seed-retention path in full (every
// seed query survives with null metrics). Tests that DO care about specific
// keyword content/cost use their own dedicated stub (see
// orchestration/research-handlers.test.ts).
//
// Task 11 adds discover_competitors as the third real stage handler in this
// same path (competitors_domain for existing_site mode, serp_competitors for
// greenfield). Same empty-item convention applies: a full-drive test still
// exercises the handler's known-competitor-selection path (a known
// competitor with zero discovered candidates still gets persisted +
// selected), it just never sees real discovered candidates.

function catalogTaskResponse(records: unknown[]) {
  return {
    status_code: 20000,
    tasks: [{ id: 'catalog-task', status_code: 20000, status_message: 'Ok.', cost: 0, result: records }],
  };
}

const DEFAULT_LABS_COUNTRIES = [
  {
    location_code: 2840,
    location_name: 'United States',
    country_iso_code: 'US',
    location_type: 'Country',
    languages: [{ language_code: 'en', language_name: 'English' }],
  },
];

const DEFAULT_SERP_LOCATIONS_US = [
  { location_code: 2840, location_name: 'United States', country_iso_code: 'US', location_type: 'Country' },
  { location_code: 1023191, location_name: 'Austin,Texas,United States', country_iso_code: 'US', location_type: 'City' },
  {
    location_code: 1023292,
    location_name: 'Round Rock,Texas,United States',
    country_iso_code: 'US',
    location_type: 'City',
  },
];

const DEFAULT_SERP_LANGUAGES = [
  { language_code: 'en', language_name: 'English' },
  { language_code: 'es', language_name: 'Spanish' },
];

// A billable Labs "live" task response with zero items: still a valid,
// successful (status_code 20000) single-task response, so blueprintDfsCall
// treats it as a normal miss (not the "all tasks failed"/"zero tasks"
// invalid-response cases) and simply returns an empty candidate list.
function emptyLabsTaskResponse() {
  return {
    status_code: 20000,
    tasks: [{ id: 'labs-task', status_code: 20000, status_message: 'Ok.', cost: 0, result: [{ items: [] }] }],
  };
}

const LABS_KEYWORD_ENDPOINTS = [
  '/dataforseo_labs/google/keyword_ideas/live',
  '/dataforseo_labs/google/keyword_suggestions/live',
  '/dataforseo_labs/google/keywords_for_site/live',
  '/dataforseo_labs/google/keyword_overview/live',
  '/dataforseo_labs/google/bulk_keyword_difficulty/live',
  '/dataforseo_labs/google/competitors_domain/live',
  '/dataforseo_labs/google/serp_competitors/live',
  // Task 12 adds collect_competitor_evidence as a fourth real stage handler
  // in this same full-drive path. A known (user-supplied) competitor is
  // always selected regardless of what competitors_domain/serp_competitors
  // discovered above, so any full-drive test whose sample brief carries a
  // knownCompetitorDomains entry (e.g. process-run.test.ts's SAMPLE_BRIEF_
  // INPUT) reaches these two endpoints too. Same empty-item convention.
  '/dataforseo_labs/google/ranked_keywords/live',
  '/dataforseo_labs/google/relevant_pages/live',
];

// Installs the stub and returns a restore function; callers are responsible
// for restoring the original fetch (typically in afterEach), matching the
// pattern already used by providers/dataforseo/call.test.ts.
export function installDfsCatalogFetchStub(): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any) => {
    const href = String(url);
    if (href.includes('/dataforseo_labs/locations_and_languages')) {
      return { ok: true, status: 200, json: async () => catalogTaskResponse(DEFAULT_LABS_COUNTRIES) } as any;
    }
    if (href.includes('/serp/google/locations/')) {
      return { ok: true, status: 200, json: async () => catalogTaskResponse(DEFAULT_SERP_LOCATIONS_US) } as any;
    }
    if (href.includes('/serp/google/languages')) {
      return { ok: true, status: 200, json: async () => catalogTaskResponse(DEFAULT_SERP_LANGUAGES) } as any;
    }
    if (LABS_KEYWORD_ENDPOINTS.some((endpoint) => href.includes(endpoint))) {
      return { ok: true, status: 200, json: async () => emptyLabsTaskResponse() } as any;
    }
    throw new Error(`installDfsCatalogFetchStub: unexpected fetch to ${href}`);
  }) as any;
  return () => {
    globalThis.fetch = original;
  };
}

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
    throw new Error(`installDfsCatalogFetchStub: unexpected fetch to ${href}`);
  }) as any;
  return () => {
    globalThis.fetch = original;
  };
}

import type { StageContext } from '../../orchestration/handlers';
import { BlueprintApiError } from '../../domain/api-errors';
import { BlueprintValidationError } from '../../domain/errors';
import { blueprintDfsCall } from './call';
import { safeErrorMessage } from './envelope';

// Contract Tasks 9-13 import this exact shape: a resolved market pins one
// Labs location code and language for the whole run, plus a best-effort SERP
// location per service area (falling back to the country-level SERP code
// when a service area's city cannot be matched in the catalog).
export interface ResolvedMarket {
  labsLocationCode: number; // country-level, e.g. 2840
  languageCode: string;
  serpLocations: Array<{ serviceAreaId: string; locationCode: number; locationName: string }>;
  fallbackSerpLocationCode: number; // country-level SERP code
  unresolvedAreaIds: string[];
}

// 7-day TTL for these catalogs: location/language taxonomies change rarely
// enough that re-fetching per run would just burn a subrequest for no benefit.
const CATALOG_TTL_SECONDS = 604_800;
const CATALOG_EMPTY_TTL_SECONDS = 21_600;

interface DfsLabsCountryEntry {
  location_code: number;
  location_name?: string;
  country_iso_code?: string;
  location_type?: string;
  languages?: Array<{ language_code: string; language_name?: string }>;
}

interface DfsSerpLocationEntry {
  location_code: number;
  location_name?: string;
  country_iso_code?: string;
  location_type?: string;
}

interface DfsSerpLanguageEntry {
  language_code: string;
  language_name?: string;
}

// DataForSEO's catalog/reference endpoints (locations_and_languages, the
// SERP locations list, the SERP languages list) return each record directly
// in `tasks[].result` -- unlike the "live" task endpoints, these are not
// wrapped in a per-result `items` array. blueprintDfsCall's `results` field
// (not `items`) is where these records land after envelope parsing.
async function fetchLabsCountries(ctx: StageContext): Promise<DfsLabsCountryEntry[]> {
  const result = await blueprintDfsCall(ctx, {
    method: 'GET',
    endpoint: '/dataforseo_labs/locations_and_languages',
    ttlSeconds: CATALOG_TTL_SECONDS,
    emptyTtlSeconds: CATALOG_EMPTY_TTL_SECONDS,
    kind: 'business_fact',
    operation: 'labs_locations_and_languages',
    scopeId: 'catalog',
    estimateUsdMicro: 0,
  });
  return result.results as DfsLabsCountryEntry[];
}

async function fetchSerpLocations(ctx: StageContext, countryIso: string): Promise<DfsSerpLocationEntry[]> {
  const result = await blueprintDfsCall(ctx, {
    method: 'GET',
    endpoint: `/serp/google/locations/${countryIso.toLowerCase()}`,
    ttlSeconds: CATALOG_TTL_SECONDS,
    emptyTtlSeconds: CATALOG_EMPTY_TTL_SECONDS,
    kind: 'serp_snapshot',
    operation: 'serp_locations_catalog',
    scopeId: `catalog:${countryIso}`,
    estimateUsdMicro: 0,
  });
  return result.results as DfsSerpLocationEntry[];
}

async function fetchSerpLanguages(ctx: StageContext): Promise<DfsSerpLanguageEntry[]> {
  const result = await blueprintDfsCall(ctx, {
    method: 'GET',
    endpoint: '/serp/google/languages',
    ttlSeconds: CATALOG_TTL_SECONDS,
    emptyTtlSeconds: CATALOG_EMPTY_TTL_SECONDS,
    kind: 'serp_snapshot',
    operation: 'serp_languages_catalog',
    scopeId: 'catalog',
    estimateUsdMicro: 0,
  });
  return result.results as DfsSerpLanguageEntry[];
}

export async function resolveMarket(ctx: StageContext): Promise<ResolvedMarket> {
  const { normalizedBrief } = ctx;
  // normalizeProjectBrief already uppercases countryIso and lowercases
  // languageCode (domain/brief.ts), so these are used as-is.
  const countryIso = normalizedBrief.countryIso;
  const languageCode = normalizedBrief.languageCode;

  const labsCountries = await fetchLabsCountries(ctx);
  const labsCountry = labsCountries.find((entry) => entry.country_iso_code?.toUpperCase() === countryIso);
  if (!labsCountry) {
    throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
  }
  const labsLocationCode = labsCountry.location_code;

  const serpLocationEntries = await fetchSerpLocations(ctx, countryIso);
  const countryEntry = serpLocationEntries.find(
    (entry) => entry.location_type === 'Country' && entry.country_iso_code?.toUpperCase() === countryIso
  );
  if (!countryEntry) {
    throw new BlueprintApiError('provider_invalid_response', safeErrorMessage('provider_invalid_response'));
  }
  const fallbackSerpLocationCode = countryEntry.location_code;

  // Unsupported market (language not available for SERP research in this
  // country) is a permanent, user-correctable error (catalog Sec 17): the
  // user must change the brief's language/country, retrying will never help.
  const serpLanguages = await fetchSerpLanguages(ctx);
  const languageSupported = serpLanguages.some((entry) => entry.language_code === languageCode);
  if (!languageSupported) {
    throw new BlueprintValidationError('invalid_input', [
      {
        path: 'languageCode',
        message: `Unsupported market: language "${languageCode}" is not available for SERP research in ${countryIso}.`,
      },
    ]);
  }

  // Service-area resolution never fails the (required) stage: an area whose
  // city cannot be matched degrades to the country-level fallback code
  // downstream, tracked here only via unresolvedAreaIds.
  const serpLocations: ResolvedMarket['serpLocations'] = [];
  const unresolvedAreaIds: string[] = [];

  for (const area of normalizedBrief.serviceAreas) {
    const areaNameLower = area.city.trim().toLowerCase();
    const matches = serpLocationEntries.filter(
      (entry) => typeof entry.location_name === 'string' && entry.location_name.toLowerCase().startsWith(areaNameLower)
    );
    const match = matches.find((entry) => entry.location_type === 'City') ?? matches[0];
    if (match) {
      serpLocations.push({
        serviceAreaId: area.id,
        locationCode: match.location_code,
        locationName: match.location_name ?? '',
      });
    } else {
      unresolvedAreaIds.push(area.id);
    }
  }

  return {
    labsLocationCode,
    languageCode,
    serpLocations,
    fallbackSerpLocationCode,
    unresolvedAreaIds,
  };
}

// Where a Local Pack check "stands" when it queries Google Maps.
//
// Bug e2fc2a9c (appixi.com, Cumming GA): the app showed pack position 1 while a
// real search from Cumming did not show the business at all. Every local-pack
// query sent only `location_code` (2840 = the whole United States), so
// DataForSEO rendered Maps at zoom 4 over the country. Those results are both
// unstable and unrelated to what a searcher in the business's city sees.
// Anchoring the query at the business coordinates (the same center the
// geo-grid uses) reproduces a local searcher's viewport.

export const LOCAL_PACK_ZOOM = 14;
export const DEFAULT_LOCATION_CODE = 2840;

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export type MapsSearchAnchor =
  | { kind: 'coordinate'; location_coordinate: string; key: string }
  | { kind: 'code'; location_code: number; key: string };

export function coordinateString(point: GeoPoint, zoom: number = LOCAL_PACK_ZOOM): string {
  return `${point.latitude},${point.longitude},${zoom}z`;
}

export function isGeoPoint(value: { latitude?: unknown; longitude?: unknown } | null | undefined): value is GeoPoint {
  return !!value
    && typeof value.latitude === 'number' && Number.isFinite(value.latitude)
    && typeof value.longitude === 'number' && Number.isFinite(value.longitude)
    && !(value.latitude === 0 && value.longitude === 0);
}

// Coordinates win; otherwise fall back to the most specific location code we have.
export function mapsSearchAnchor(
  point: { latitude?: unknown; longitude?: unknown } | null | undefined,
  ...locationCodes: Array<number | null | undefined>
): MapsSearchAnchor {
  if (isGeoPoint(point)) {
    const location_coordinate = coordinateString(point);
    return { kind: 'coordinate', location_coordinate, key: `coord:${location_coordinate}` };
  }
  const code = locationCodes.find((c) => typeof c === 'number' && Number.isFinite(c) && c > 0) ?? DEFAULT_LOCATION_CODE;
  return { kind: 'code', location_code: code, key: `loc:${code}` };
}

export function buildMapsSerpTask(
  keyword: string,
  anchor: MapsSearchAnchor,
  languageCode: string = 'en',
  depth: number = 20,
): Record<string, unknown> {
  const task: Record<string, unknown> = {
    keyword,
    language_code: languageCode || 'en',
    device: 'desktop',
    os: 'windows',
    depth,
  };
  if (anchor.kind === 'coordinate') task.location_coordinate = anchor.location_coordinate;
  else task.location_code = anchor.location_code;
  return task;
}

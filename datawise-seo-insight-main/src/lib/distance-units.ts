// GeoGrid radius units. Scans are always sent and stored in km; miles are a
// display and input preference only (report ebdcb419).
export type DistanceUnit = 'km' | 'mi';

export const KM_PER_MILE = 1.609344;

const RADIUS_OPTIONS: Record<DistanceUnit, number[]> = {
  km: [1, 3, 5, 10, 15],
  mi: [0.5, 1, 2, 3, 5, 10],
};

function trim(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** km value to store/send for a radius picked in `unit`. 3 decimals is plenty for a scan radius. */
export function toKm(value: number, unit: DistanceUnit): number {
  return unit === 'km' ? value : Math.round(value * KM_PER_MILE * 1000) / 1000;
}

/** Radius choices for a unit, as { value: km string, label }. */
export function radiusOptions(unit: DistanceUnit): Array<{ value: string; label: string }> {
  return RADIUS_OPTIONS[unit].map((v) => ({ value: String(toKm(v, unit)), label: `${v} ${unit}` }));
}

/** Human label for a stored km radius in the preferred unit, e.g. "5 km" or "3.1 mi". */
export function formatRadius(km: number, unit: DistanceUnit): string {
  return unit === 'km' ? `${trim(km)} km` : `${trim(km / KM_PER_MILE)} mi`;
}

const STORAGE_KEY = 'datawise_geogrid_radius_unit';

export function loadDistanceUnit(): DistanceUnit {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'mi' ? 'mi' : 'km';
  } catch {
    return 'km';
  }
}

export function saveDistanceUnit(unit: DistanceUnit): void {
  try { localStorage.setItem(STORAGE_KEY, unit); } catch { /* private mode: keep in memory only */ }
}

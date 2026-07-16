// Shared recommendation badge color mapping so the map (PageCardNode) and
// table (PageTable) views render identical colors for the same value.

export const RECOMMENDATION_STYLES: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-900',
  update: 'bg-amber-100 text-amber-900',
  keep: 'bg-blue-100 text-blue-900',
  consolidate: 'bg-slate-100 text-slate-900',
};

export function recommendationClassName(recommendation: string): string {
  return RECOMMENDATION_STYLES[recommendation] ?? RECOMMENDATION_STYLES.keep;
}

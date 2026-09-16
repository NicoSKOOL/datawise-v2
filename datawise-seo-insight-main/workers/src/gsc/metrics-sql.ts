// Impression-weighted aggregates for gsc_search_data.
//
// Every stored row is one (query, page) or (query, page, day) slice, and each
// carries Search Console's own impression-weighted position for that slice.
// Averaging those rows with AVG(position) gives every slice the same weight,
// so a brand query that ranks #1 on the home page (thousands of impressions)
// and also surfaces 60 deep pages at position 20-60 (a handful of impressions
// each) reported position 20 while Search Console showed 1.9. Weighting by
// impressions reproduces the number Search Console itself displays.
//
// Reported 2026-09-16 for harbourholidays.co.uk: "harbour holidays" showed
// 20.1 (plain AVG over 59 agg90 rows) against 1.9 weighted.
//
// NULLIF keeps a zero-impression group from dividing by zero: it yields NULL,
// which every caller already renders as "no data".

export function weightedPositionSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `SUM(${p}position * ${p}impressions) * 1.0 / NULLIF(SUM(${p}impressions), 0)`;
}

export function weightedCtrSql(alias = ''): string {
  const p = alias ? `${alias}.` : '';
  return `SUM(${p}clicks) * 1.0 / NULLIF(SUM(${p}impressions), 0)`;
}

export const WEIGHTED_POSITION = weightedPositionSql();
export const WEIGHTED_CTR = weightedCtrSql();

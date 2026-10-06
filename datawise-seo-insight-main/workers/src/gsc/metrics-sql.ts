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

// Per-query rollup that reports the TOP PAGE's position, not the blend.
//
// Even impression-weighted, a query's position averages every page of the
// site that surfaced for it. A site whose main page ranks #3 but that also
// shows 15 thin pages at #20-80 reads as #14, which is what Search Console's
// own query view shows and not where searchers see the site. Reported
// 2026-10-01 for harbourholidays.co.uk: "padstow cottages" showed 13.7 while
// /locations/padstow-holiday-cottages/ (3,022 of ~4,400 impressions, nearly
// all clicks) ranked 3.3.
//
// avg_position is the position of the page with the most impressions for the
// query (clicks break ties), so existing sorts, filters and buckets keyed on
// avg_position now use the top page. all_pages_position keeps the blended
// Search Console number, ranking_pages counts the competing pages.
//
// `scope` filters gsc_search_data with unprefixed columns and must start with
// the property filter; the CTE binds exactly the parameters that `scope` uses.
// Callers SELECT ... FROM query_rollup.
export function queryRollupCte(scope: string): string {
  return `
    per_page AS (
      SELECT query, page,
             SUM(clicks) as clicks,
             SUM(impressions) as impressions,
             SUM(position * impressions) as position_x_impressions
      FROM gsc_search_data
      WHERE ${scope}
      GROUP BY query, page
    ),
    ranked_pages AS (
      SELECT *,
             ROW_NUMBER() OVER (PARTITION BY query ORDER BY impressions DESC, clicks DESC, page) as page_rank
      FROM per_page
    ),
    query_rollup AS (
      SELECT query,
             SUM(clicks) as clicks,
             SUM(impressions) as impressions,
             ROUND(MAX(CASE WHEN page_rank = 1
               THEN position_x_impressions * 1.0 / NULLIF(impressions, 0) END), 1) as avg_position,
             ROUND(SUM(position_x_impressions) * 1.0 / NULLIF(SUM(impressions), 0), 1) as all_pages_position,
             ROUND(SUM(clicks) * 1.0 / NULLIF(SUM(impressions), 0), 4) as avg_ctr,
             MAX(CASE WHEN page_rank = 1 THEN page END) as top_page,
             COUNT(*) as ranking_pages
      FROM ranked_pages
      GROUP BY query
    )`;
}

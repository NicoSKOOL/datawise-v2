import { normalizePlannerKeyword } from './planner-keyword-selection';

// CSV export honours the row checkboxes: selected questions only when any are
// ticked, otherwise every question (bug d8341bf6).
export function pickPaaExportRows<T extends { question: string }>(rows: T[], selectedKeys: Set<string>): T[] {
  if (selectedKeys.size === 0) return rows;
  return rows.filter((row) => selectedKeys.has(normalizePlannerKeyword(row.question)));
}

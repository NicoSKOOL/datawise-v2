import type { PlannerIntent, PlannerItemInput } from './planner';

type KeywordRow = Record<string, unknown>;

const PLANNER_INTENTS: PlannerIntent[] = [
  'transactional',
  'informational',
  'commercial',
  'navigational',
  'fan_out',
];

export function toPlannerIntent(value: unknown): PlannerIntent | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase() as PlannerIntent;
  return PLANNER_INTENTS.includes(normalized) ? normalized : undefined;
}

interface BuildPlannerItemOptions {
  source: string;
  intent?: PlannerIntent;
  sourceContext?: unknown;
  getRowIntent?: (row: Record<string, unknown>) => PlannerIntent | undefined;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizePlannerKeyword(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).trim().toLowerCase();
}

export function getKeywordRowKey(row: KeywordRow, _index: number): string {
  return normalizePlannerKeyword(row.keyword);
}

export function toggleSelectedKeyword(
  current: Set<string>,
  keywordKey: string,
  checked: boolean,
): Set<string> {
  const next = new Set(current);
  if (!keywordKey) return next;
  if (checked) next.add(keywordKey);
  else next.delete(keywordKey);
  return next;
}

function buildSourceContext(row: KeywordRow, sourceContext: unknown): unknown {
  if (
    sourceContext &&
    typeof sourceContext === 'object' &&
    !Array.isArray(sourceContext)
  ) {
    return {
      ...(sourceContext as Record<string, unknown>),
      result: row,
    };
  }

  if (sourceContext === null || sourceContext === undefined) {
    return { result: row };
  }

  return {
    context: sourceContext,
    result: row,
  };
}

export function buildPlannerItem(
  row: KeywordRow,
  options: BuildPlannerItemOptions,
): PlannerItemInput | null {
  const keyword = normalizePlannerKeyword(row.keyword);
  if (!keyword) return null;

  return {
    keyword,
    intent: options.getRowIntent?.(row) ?? options.intent,
    source: options.source,
    search_volume: nullableNumber(row.search_volume),
    keyword_difficulty: nullableNumber(row.keyword_difficulty),
    cpc: nullableNumber(row.cpc),
    competition: nullableNumber(row.competition),
    source_context: buildSourceContext(row, options.sourceContext),
  };
}

export function getSelectedPlannerItems(
  rows: KeywordRow[],
  selectedKeywordKeys: Set<string>,
  options: BuildPlannerItemOptions,
): PlannerItemInput[] {
  return rows
    .filter((row, index) => selectedKeywordKeys.has(getKeywordRowKey(row, index)))
    .map((row) => buildPlannerItem(row, options))
    .filter((item): item is PlannerItemInput => item !== null);
}

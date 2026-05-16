export type SortDirection = 'asc' | 'desc';

export interface TableSortState {
  column: string;
  direction: SortDirection;
}

const UNKNOWN_COMPETITION_RANK = 99;

export function getCompetitionLevelRank(value: unknown): number {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (!normalized || normalized === '-' || normalized === 'unknown' || normalized === 'n/a') {
    return UNKNOWN_COMPETITION_RANK;
  }

  if (normalized.includes('low')) return 0;
  if (normalized.includes('medium')) return 1;
  if (normalized.includes('high')) return 2;

  return UNKNOWN_COMPETITION_RANK;
}

function isEmptySortValue(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== 'string') return false;

  const normalized = value.trim().toLowerCase();
  return normalized === '' || normalized === '-' || normalized === 'n/a' || normalized === 'unknown';
}

function asSortableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;

  const normalized = value.trim().replace(/[$,%\s,]/g, '');
  if (!normalized) return null;

  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

export function compareTableValues(
  a: unknown,
  b: unknown,
  column: string,
  direction: SortDirection,
): number {
  if (column === 'competition_level') {
    const aRank = getCompetitionLevelRank(a);
    const bRank = getCompetitionLevelRank(b);
    const aKnown = aRank !== UNKNOWN_COMPETITION_RANK;
    const bKnown = bRank !== UNKNOWN_COMPETITION_RANK;

    if (aKnown !== bKnown) return aKnown ? -1 : 1;
    if (!aKnown && !bKnown) return 0;

    const comparison = aRank - bRank;
    return direction === 'asc' ? comparison : -comparison;
  }

  const aEmpty = isEmptySortValue(a);
  const bEmpty = isEmptySortValue(b);

  if (aEmpty !== bEmpty) return aEmpty ? 1 : -1;
  if (aEmpty && bEmpty) return 0;

  const aNumber = asSortableNumber(a);
  const bNumber = asSortableNumber(b);

  if (aNumber != null && bNumber != null) {
    const comparison = aNumber - bNumber;
    return direction === 'asc' ? comparison : -comparison;
  }

  const comparison = String(a ?? '').localeCompare(String(b ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });

  return direction === 'asc' ? comparison : -comparison;
}

export function sortTableRows<T extends Record<string, unknown>>(
  rows: T[],
  sortState: TableSortState | null,
): T[] {
  if (!sortState) return rows;

  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const comparison = compareTableValues(
        a.row[sortState.column],
        b.row[sortState.column],
        sortState.column,
        sortState.direction,
      );

      return comparison || a.index - b.index;
    })
    .map(({ row }) => row);
}

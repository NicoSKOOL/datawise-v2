export type KeywordMetricKey =
  | 'search_volume'
  | 'keyword_difficulty'
  | 'competition'
  | 'competition_level'
  | 'cpc';

export type KeywordMetricTone = 'green' | 'amber' | 'red' | 'neutral';

export interface KeywordMetricDefinition {
  label: string;
  shortLabel: string;
  description: string;
  hint: string;
  higherIsBetter: boolean;
  format: (value: unknown) => string;
}

export interface KeywordMetricStats {
  min: number;
  max: number;
}

const numberFormat = new Intl.NumberFormat('en-US');

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const numeric = Number(value.replace(/[$,%]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

function formatNumber(value: unknown): string {
  const numeric = asNumber(value);
  return numeric == null ? String(value ?? '-') : numberFormat.format(numeric);
}

function formatCurrency(value: unknown): string {
  const numeric = asNumber(value);
  return numeric == null ? '$--' : `$${numeric.toFixed(2)}`;
}

function formatPercent(value: unknown): string {
  const numeric = asNumber(value);
  if (numeric == null) return String(value ?? '-');
  const pct = numeric <= 1 ? numeric * 100 : numeric;
  return `${Math.round(pct)}%`;
}

export const KEYWORD_METRIC_DEFINITIONS: Record<KeywordMetricKey, KeywordMetricDefinition> = {
  search_volume: {
    label: 'Search Volume',
    shortLabel: 'Volume',
    description: 'Average monthly searches for the keyword in the selected market.',
    hint: 'Green means stronger demand.',
    higherIsBetter: true,
    format: formatNumber,
  },
  keyword_difficulty: {
    label: 'Keyword Difficulty',
    shortLabel: 'KD',
    description: 'Estimated ranking difficulty on a 0-100 scale.',
    hint: 'Green means easier to rank.',
    higherIsBetter: false,
    format: formatNumber,
  },
  competition: {
    label: 'Competition',
    shortLabel: 'Competition',
    description: 'Paid-search competition level for advertisers.',
    hint: 'Green means lower competition.',
    higherIsBetter: false,
    format: formatPercent,
  },
  competition_level: {
    label: 'Competition Level',
    shortLabel: 'Comp. Level',
    description: 'DataForSEO paid-search competition bucket.',
    hint: 'Low is easier; high is more competitive.',
    higherIsBetter: false,
    format: (value) => String(value ?? '-'),
  },
  cpc: {
    label: 'Cost Per Click',
    shortLabel: 'CPC',
    description: 'Average cost per click advertisers pay for this keyword.',
    hint: 'Green means higher CPC and stronger commercial value.',
    higherIsBetter: true,
    format: formatCurrency,
  },
};

export function isKeywordMetricKey(value: string): value is KeywordMetricKey {
  return value in KEYWORD_METRIC_DEFINITIONS;
}

export function getKeywordMetricStats(rows: object[]): Partial<Record<KeywordMetricKey, KeywordMetricStats>> {
  const stats: Partial<Record<KeywordMetricKey, KeywordMetricStats>> = {};

  for (const key of Object.keys(KEYWORD_METRIC_DEFINITIONS) as KeywordMetricKey[]) {
    const values = rows
      .map((row) => asNumber((row as Record<string, unknown>)[key]))
      .filter((value): value is number => value != null);

    if (values.length > 0) {
      stats[key] = { min: Math.min(...values), max: Math.max(...values) };
    }
  }

  return stats;
}

export function getKeywordMetricTone(
  metric: KeywordMetricKey,
  value: unknown,
  stats?: KeywordMetricStats,
): KeywordMetricTone {
  if (metric === 'competition_level') {
    const level = String(value ?? '').toLowerCase();
    if (level.includes('low')) return 'green';
    if (level.includes('high')) return 'red';
    if (level.includes('medium')) return 'amber';
    return 'neutral';
  }

  const numeric = asNumber(value);
  if (numeric == null || numeric === 0) return 'neutral';

  const definition = KEYWORD_METRIC_DEFINITIONS[metric];
  const min = stats?.min ?? 0;
  const max = stats?.max ?? (metric === 'keyword_difficulty' ? 100 : numeric);
  const range = max - min;
  const normalized = range > 0 ? (numeric - min) / range : 0.5;
  const score = definition.higherIsBetter ? normalized : 1 - normalized;

  if (score >= 0.66) return 'green';
  if (score >= 0.33) return 'amber';
  return 'red';
}

export function formatKeywordMetricValue(metric: KeywordMetricKey, value: unknown): string {
  return KEYWORD_METRIC_DEFINITIONS[metric].format(value);
}

export interface LlmHistoricalItem {
  year: number;
  month: number;
  metrics?: {
    mentions?: number;
    ai_search_volume?: number;
  } | null;
}

export interface HistoricalPoint {
  month: string;
  label: string;
  mentions: number;
  aiVolume: number;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  // timeZone must be pinned to UTC: the date is built with Date.UTC, so
  // formatting in a behind-UTC locale would render the 1st as the previous
  // month (Jan 2026 showing as "Dec 25").
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });
}

// DFS returns one item per calendar month per requested platform. Active
// platforms are summed into a single point so the chart matches the toggles,
// and gap months are filled so the line stays continuous.
export function mergeHistoricalSeries(
  series: Array<LlmHistoricalItem[] | null | undefined>
): HistoricalPoint[] {
  const buckets = new Map<string, { mentions: number; aiVolume: number }>();

  for (const list of series) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item?.year || !item?.month) continue;
      const key = monthKey(item.year, item.month);
      const entry = buckets.get(key) ?? { mentions: 0, aiVolume: 0 };
      entry.mentions += Number(item.metrics?.mentions ?? 0);
      entry.aiVolume += Number(item.metrics?.ai_search_volume ?? 0);
      buckets.set(key, entry);
    }
  }

  const keys = Array.from(buckets.keys()).sort();
  if (!keys.length) return [];

  const filled: HistoricalPoint[] = [];
  const [firstY, firstM] = keys[0].split('-').map(Number);
  const [lastY, lastM] = keys[keys.length - 1].split('-').map(Number);
  let y = firstY;
  let m = firstM;
  while (y < lastY || (y === lastY && m <= lastM)) {
    const key = monthKey(y, m);
    const entry = buckets.get(key) ?? { mentions: 0, aiVolume: 0 };
    filled.push({ month: key, label: formatMonthLabel(key), ...entry });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return filled;
}

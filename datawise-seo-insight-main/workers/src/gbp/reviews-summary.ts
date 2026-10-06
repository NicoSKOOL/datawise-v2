// Cheap, LLM-free numbers over a review sample. The model does the reading;
// this just saves it from counting.

export interface ReviewRow {
  rating: number | null;
  text: string;
  date: string | null;
  owner_response: string | null;
  owner_response_date: string | null;
  author: string;
}

export interface ReviewSummary {
  fetched: number;
  reply_rate_pct: number | null;
  avg_days_to_reply: number | null;
  unanswered_low_star: number;
  newest_date: string | null;
  oldest_date: string | null;
  service_mentions_hint: string[];
}

const STOPWORDS = new Set(['this', 'that', 'with', 'they', 'them', 'their', 'have', 'been', 'were', 'very', 'from', 'would', 'about',
  'great', 'good', 'nice', 'really', 'highly', 'recommend', 'recommended', 'service', 'services', 'thank', 'thanks', 'best', 'will',
  'when', 'what', 'which', 'there', 'here', 'your', 'just', 'also', 'much', 'more', 'than', 'then', 'these', 'those', 'into',
  'over', 'after', 'before', 'again', 'because', 'could', 'should', 'made', 'make', 'came',
  'come', 'went', 'time',
  'friendly', 'professional', 'excellent', 'amazing', 'awesome', 'team', 'guys', 'staff', 'experience', 'definitely', 'always',
  'every', 'everything', 'thing', 'things', 'work', 'done', 'well', 'even', 'only', 'some', 'most', 'many', 'such', 'both']);

function parseDate(s: string | null): number | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

export function summarizeReviews(rows: ReviewRow[]): ReviewSummary {
  if (rows.length === 0) {
    return { fetched: 0, reply_rate_pct: null, avg_days_to_reply: null, unanswered_low_star: 0, newest_date: null, oldest_date: null, service_mentions_hint: [] };
  }
  const replied = rows.filter((r) => r.owner_response && r.owner_response.trim());
  const lags: number[] = [];
  for (const r of replied) {
    const a = parseDate(r.date), b = parseDate(r.owner_response_date);
    if (a !== null && b !== null && b >= a) lags.push((b - a) / 86_400_000);
  }
  const dated = rows.map((r) => ({ r, t: parseDate(r.date) })).filter((x): x is { r: ReviewRow; t: number } => x.t !== null).sort((x, y) => y.t - x.t);

  const counts = new Map<string, number>();
  for (const r of rows) {
    for (const w of r.text.toLowerCase().match(/[a-záéíóúñü]{4,}/g) ?? []) {
      if (STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  const hint = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15).map(([w]) => w);

  return {
    fetched: rows.length,
    reply_rate_pct: Math.round((replied.length / rows.length) * 100),
    avg_days_to_reply: lags.length ? Math.round(lags.reduce((s, d) => s + d, 0) / lags.length) : null,
    unanswered_low_star: rows.filter((r) => (r.rating ?? 5) <= 3 && !(r.owner_response && r.owner_response.trim())).length,
    newest_date: dated[0]?.r.date ?? null,
    oldest_date: dated.at(-1)?.r.date ?? null,
    service_mentions_hint: hint,
  };
}

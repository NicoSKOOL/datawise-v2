import type { ReviewItem } from '@/types/local-seo';

interface SentimentTrendProps {
  reviews: ReviewItem[];
}

interface MonthBucket {
  key: string;
  label: string;
  positive: number;
  neutral: number;
  negative: number;
}

// Monthly sentiment mix derived from star ratings (4-5 positive, 3 neutral,
// 1-2 negative). Covers only the fetched reviews, so the caption states the
// real range instead of implying a fixed window.
export default function SentimentTrend({ reviews }: SentimentTrendProps) {
  const dated = reviews.filter((r) => r.date && r.rating != null);
  if (dated.length === 0) {
    return <p className="text-xs text-muted-foreground">No dated reviews available to chart.</p>;
  }

  const buckets = new Map<string, MonthBucket>();
  let earliest = new Date();
  for (const r of dated) {
    const d = new Date(r.date as string);
    if (isNaN(d.getTime())) continue;
    if (d < earliest) earliest = d;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    let b = buckets.get(key);
    if (!b) {
      b = { key, label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' }), positive: 0, neutral: 0, negative: 0 };
      buckets.set(key, b);
    }
    const rating = r.rating as number;
    if (rating >= 4) b.positive += 1;
    else if (rating >= 3) b.neutral += 1;
    else b.negative += 1;
  }

  const months = Array.from(buckets.values()).sort((a, b) => a.key.localeCompare(b.key)).slice(-12);
  const maxTotal = Math.max(...months.map((m) => m.positive + m.neutral + m.negative), 1);
  const totals = months.reduce(
    (acc, m) => ({ positive: acc.positive + m.positive, neutral: acc.neutral + m.neutral, negative: acc.negative + m.negative }),
    { positive: 0, neutral: 0, negative: 0 },
  );

  return (
    <div className="space-y-2">
      <div className="flex items-end gap-1.5 h-32">
        {months.map((m) => {
          const total = m.positive + m.neutral + m.negative;
          const heightPct = (total / maxTotal) * 100;
          return (
            <div key={m.key} className="flex-1 flex flex-col justify-end items-center gap-1 min-w-0">
              <div
                className="w-full max-w-[34px] flex flex-col-reverse rounded-sm overflow-hidden"
                style={{ height: `${heightPct}%`, minHeight: total > 0 ? 6 : 0 }}
                title={`${m.label}: ${m.positive} positive, ${m.neutral} neutral, ${m.negative} negative`}
              >
                <div className="bg-emerald-600 w-full" style={{ flexGrow: m.positive }} />
                <div className="bg-amber-400 w-full" style={{ flexGrow: m.neutral }} />
                <div className="bg-red-500 w-full" style={{ flexGrow: m.negative }} />
              </div>
              <span className="text-[9px] text-muted-foreground truncate w-full text-center">{m.label}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-emerald-600 inline-block" />Positive (4-5 stars): {totals.positive}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-amber-400 inline-block" />Neutral (3): {totals.neutral}</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm bg-red-500 inline-block" />Negative (1-2): {totals.negative}</span>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Based on the {dated.length} most recent reviews, since {earliest.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}.
      </p>
    </div>
  );
}

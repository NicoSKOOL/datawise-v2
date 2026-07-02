import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
  AI_OUTCOME_COLORS,
  type AIEngine, type AIShareOfVoiceRow, type AITrackedQuery, type AITrendPoint,
} from '@/lib/ai-tracking';

function shortDate(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function nextMondayCheck(): string {
  const now = new Date();
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 6, 0, 0));
  const day = candidate.getUTCDay();
  candidate.setUTCDate(candidate.getUTCDate() + ((1 - day + 7) % 7 || (candidate <= now ? 7 : 0)));
  if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 7);
  return candidate.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
}

// --- Trend mini ---------------------------------------------------------

interface TrendMiniCardProps {
  trend: AITrendPoint[];
  engines: AIEngine[];
  period: 7 | 30 | 90;
  onPeriodChange: (period: 7 | 30 | 90) => void;
}

export function TrendMiniCard({ trend, engines, period, onPeriodChange }: TrendMiniCardProps) {
  const rows = useMemo(() => {
    const byDate = new Map<string, { date: string; cited: number; mentioned: number; absent: number; total: number }>();
    for (const point of trend) {
      if (!engines.includes(point.engine)) continue;
      const row = byDate.get(point.date) || { date: point.date, cited: 0, mentioned: 0, absent: 0, total: 0 };
      row.cited += point.cited;
      row.mentioned += point.mentioned;
      row.absent += Math.max(0, point.total - point.cited - point.mentioned);
      row.total += point.total;
      byDate.set(point.date, row);
    }
    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  }, [trend, engines]);

  const BAR = 96;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Trend</div>
          <div className="ml-auto flex gap-0.5 rounded-full bg-secondary p-0.5">
            {([7, 30, 90] as const).map(days => (
              <button
                key={days}
                type="button"
                onClick={() => onPeriodChange(days)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                  period === days ? 'bg-card text-[#166337] shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>

        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">No checks in this range yet.</p>
        )}

        {rows.length === 1 && (
          <div className="flex flex-col gap-2 rounded-lg bg-[#F3F8F4] p-3.5">
            <div className="text-xs font-bold">Only one check in {period} days</div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Checks run weekly, so there is no line yet. Next point: <b className="text-foreground/80">{nextMondayCheck()}</b>.
            </p>
            <div className="mt-0.5 flex h-3 overflow-hidden rounded-full">
              {rows[0].cited > 0 && <div style={{ width: `${(100 * rows[0].cited) / rows[0].total}%`, background: AI_OUTCOME_COLORS.cited }} />}
              {rows[0].mentioned > 0 && <div style={{ width: `${(100 * rows[0].mentioned) / rows[0].total}%`, background: AI_OUTCOME_COLORS.mentioned }} />}
              {rows[0].absent > 0 && <div style={{ width: `${(100 * rows[0].absent) / rows[0].total}%`, background: AI_OUTCOME_COLORS.absent }} />}
            </div>
            <div className="text-[11px] text-muted-foreground">{rows[0].cited} cited · {rows[0].mentioned} mentioned · {rows[0].absent} absent</div>
          </div>
        )}

        {rows.length >= 2 && (
          <>
            <div className="flex items-end gap-1" style={{ height: BAR }}>
              {rows.map(row => {
                const scale = row.total > 0 ? BAR / row.total : 0;
                return (
                  <div
                    key={row.date}
                    className="flex min-w-0 flex-1 flex-col justify-end"
                    title={`${shortDate(row.date)}: ${row.cited} cited, ${row.mentioned} mentioned, ${row.absent} absent of ${row.total}`}
                  >
                    {/* Baseline-anchored: cited (dark) grows up from the bottom. */}
                    <div style={{ height: row.absent * scale, background: AI_OUTCOME_COLORS.absent, borderRadius: '2px 2px 0 0' }} />
                    <div style={{ height: row.mentioned * scale, background: AI_OUTCOME_COLORS.mentioned }} />
                    <div style={{ height: row.cited * scale, background: AI_OUTCOME_COLORS.cited }} />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{shortDate(rows[0].date)}</span>
              <span>{shortDate(rows[rows.length - 1].date)}</span>
            </div>
            <div className="text-[11px] text-muted-foreground">Share of answers per check: cited, mentioned, absent. One point per week.</div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// --- Share of voice ------------------------------------------------------

export function ShareOfVoiceCard({ share }: { share: AIShareOfVoiceRow[] }) {
  if (!share.length) return null;
  const top = share.slice(0, 6);
  const youIndex = share.findIndex(row => row.is_you);
  if (youIndex >= 6) top.push(share[youIndex]);
  const max = Math.max(...share.map(row => row.citations), 1);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Share of voice</div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Who AI sends people to across your queries</p>
        </div>
        <div className="flex flex-col gap-1">
          {top.map(row => (
            <div key={row.domain} className={`grid grid-cols-[1fr_40px] items-center gap-2 rounded-lg px-1.5 py-1 ${row.is_you ? 'bg-[#F3F8F4]' : ''}`}>
              <div className="flex min-w-0 flex-col gap-1">
                <div className={`flex items-center gap-1.5 text-xs ${row.is_you ? 'font-extrabold' : 'font-semibold'}`}>
                  <span className="truncate">{row.domain}</span>
                  {row.is_you && <span className="flex-shrink-0 rounded-full bg-[#1F7A43] px-1.5 py-px text-[9px] font-bold text-white">You</span>}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full" style={{ width: `${Math.max(4, (100 * row.citations) / max)}%`, background: row.is_you ? '#1F7A43' : '#C9D2CC' }} />
                </div>
              </div>
              <div className="text-right text-xs font-bold tabular-nums">{row.citations}</div>
            </div>
          ))}
        </div>
        {youIndex === -1 && (
          <p className="rounded-lg bg-secondary/60 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            You are not on this leaderboard yet: AI answers for your queries cite these domains instead of you.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// --- What to do next ------------------------------------------------------

const ACTION_ACCENT: Record<string, string> = { high: '#C97A1E', medium: '#D9A021', low: '#AAB5B3' };
const ACTION_PILL: Record<string, { bg: string; fg: string }> = {
  high: { bg: '#F9EDE0', fg: '#C97A1E' },
  medium: { bg: '#FAF3DF', fg: '#A67A12' },
  low: { bg: '#F1F4F2', fg: '#5A6968' },
};
const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

export function ActionsCard({ queries }: { queries: AITrackedQuery[] }) {
  const actions = useMemo(() =>
    queries
      .filter(q => q.recommendation)
      .map(q => ({ query: q.query_text, ...q.recommendation! }))
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3))
      .slice(0, 3),
  [queries]);

  if (!actions.length) return null;

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-5">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">What to do next</div>
          <p className="mt-0.5 text-xs text-muted-foreground">Generated from your latest check</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {actions.map((action, i) => (
            <div
              key={`${action.query}-${i}`}
              className="flex flex-col gap-1.5 rounded-r-lg bg-secondary/40 py-3 pl-3.5 pr-3.5"
              style={{ borderLeft: `3px solid ${ACTION_ACCENT[action.priority] ?? '#AAB5B3'}` }}
            >
              <div className="flex items-start gap-2">
                <span
                  className="mt-0.5 rounded-full px-2 py-px text-[9px] font-bold uppercase tracking-wide"
                  style={{ background: ACTION_PILL[action.priority]?.bg, color: ACTION_PILL[action.priority]?.fg }}
                >
                  {action.priority}
                </span>
                <span className="text-xs font-bold leading-snug">{action.title}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{action.body}</p>
              <div className="mt-auto text-[11px] text-muted-foreground/70">"{action.query}"</div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

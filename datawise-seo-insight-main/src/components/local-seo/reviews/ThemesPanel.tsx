import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, Sparkles, AlertCircle } from 'lucide-react';
import type { ReviewItem, ReviewThemesResponse } from '@/types/local-seo';
import SentimentTrend from './SentimentTrend';

interface ThemesPanelProps {
  themes: ReviewThemesResponse | null;
  reviews: ReviewItem[];
  loading: boolean;
  error: string | null;
  activeThemeIndex: number | null;
  onThemeClick: (index: number) => void;
  onRefresh: () => void;
}

const SENTIMENT_BADGE: Record<string, string> = {
  positive: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  negative: 'bg-red-50 text-red-600 border-red-200',
  mixed: 'bg-amber-50 text-amber-700 border-amber-200',
};

// Tinted card backgrounds per the approved mockup.
const SENTIMENT_CARD: Record<string, string> = {
  positive: 'border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50',
  negative: 'border-red-200 bg-red-50/60 hover:bg-red-50',
  mixed: 'border-amber-200 bg-amber-50/60 hover:bg-amber-50',
};

const SENTIMENT_BAR: Record<string, string> = {
  positive: 'bg-emerald-600',
  negative: 'bg-red-500',
  mixed: 'bg-amber-400',
};

// LLM theme analysis. Never blocks the rest of the report: skeleton while
// loading, retry hint on failure, hydrates when ready. Two views: clustered
// themes and monthly sentiment trend (computed client-side from star ratings).
export default function ThemesPanel({ themes, reviews, loading, error, activeThemeIndex, onThemeClick, onRefresh }: ThemesPanelProps) {
  const [view, setView] = useState<'themes' | 'trend'>('themes');

  const sortedThemes = themes
    ? themes.themes.map((t, originalIndex) => ({ ...t, originalIndex })).sort((a, b) => b.mention_count - a.mention_count)
    : [];
  const totalMentions = sortedThemes.reduce((sum, t) => sum + t.mention_count, 0);

  return (
    <div className="border rounded-lg p-4 bg-white space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />What customers are saying
        </p>
        <div className="flex items-center gap-1">
          <div className="flex rounded-md border overflow-hidden">
            <button
              onClick={() => setView('themes')}
              className={`px-2 py-1 text-[11px] ${view === 'themes' ? 'bg-[#005232] text-white' : 'bg-white text-muted-foreground hover:bg-muted/40'}`}
            >
              Themes
            </button>
            <button
              onClick={() => setView('trend')}
              className={`px-2 py-1 text-[11px] ${view === 'trend' ? 'bg-[#005232] text-white' : 'bg-white text-muted-foreground hover:bg-muted/40'}`}
            >
              Trend
            </button>
          </div>
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh themes
          </Button>
        </div>
      </div>

      {loading && (
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <div className="grid grid-cols-2 gap-2 pt-1">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16" />)}
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && view === 'trend' && <SentimentTrend reviews={reviews} />}

      {!loading && !error && view === 'themes' && themes && (
        <>
          <p className="text-sm">{themes.summary}</p>

          {totalMentions > 0 && (
            <div className="space-y-1">
              <div className="flex h-2.5 w-full rounded-full overflow-hidden border">
                {sortedThemes.map((t) => (
                  <button
                    key={t.originalIndex}
                    onClick={() => onThemeClick(t.originalIndex)}
                    className={`${SENTIMENT_BAR[t.sentiment]} h-full transition-opacity ${activeThemeIndex !== null && activeThemeIndex !== t.originalIndex ? 'opacity-40' : ''}`}
                    style={{ width: `${(t.mention_count / totalMentions) * 100}%` }}
                    title={`${t.theme}: ${t.mention_count} mentions (${Math.round((t.mention_count / totalMentions) * 100)}% of theme mentions)`}
                  />
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">Share of mentions across themes. Click a segment or card to filter the reviews below.</p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {sortedThemes.map((t) => (
              <button
                key={t.originalIndex}
                onClick={() => onThemeClick(t.originalIndex)}
                className={`text-left border rounded-lg p-3 transition-colors ${SENTIMENT_CARD[t.sentiment]} ${
                  activeThemeIndex === t.originalIndex ? 'ring-2 ring-[#005232]' : ''
                }`}
                title="Click to filter the review list to this theme"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t.theme}</span>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${SENTIMENT_BADGE[t.sentiment]}`}>
                    {t.sentiment}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5">{t.mention_count} mentions</p>
                {t.quotes[0] && (
                  <p className="text-xs italic text-muted-foreground mt-1 line-clamp-2">"{t.quotes[0]}"</p>
                )}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Generated {new Date(themes.generated_at).toLocaleString()}{themes.cached ? ' (cached)' : ''}
          </p>
        </>
      )}
    </div>
  );
}

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RefreshCw, Sparkles, AlertCircle } from 'lucide-react';
import type { ReviewThemesResponse } from '@/types/local-seo';

interface ThemesPanelProps {
  themes: ReviewThemesResponse | null;
  loading: boolean;
  error: string | null;
  activeThemeIndex: number | null;
  onThemeClick: (index: number) => void;
  onRefresh: () => void;
}

const SENTIMENT_STYLES: Record<string, string> = {
  positive: 'bg-green-50 text-green-700 border-green-200',
  negative: 'bg-red-50 text-red-600 border-red-200',
  mixed: 'bg-amber-50 text-amber-700 border-amber-200',
};

// LLM theme analysis. Never blocks the rest of the report: skeleton while
// loading, retry hint on failure, hydrates when ready.
export default function ThemesPanel({ themes, loading, error, activeThemeIndex, onThemeClick, onRefresh }: ThemesPanelProps) {
  return (
    <div className="border rounded-lg p-4 bg-white space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5" />What customers are saying
        </p>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onRefresh} disabled={loading}>
          <RefreshCw className={`h-3 w-3 mr-1 ${loading ? 'animate-spin' : ''}`} />
          Refresh themes
        </Button>
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

      {!loading && !error && themes && (
        <>
          <p className="text-sm">{themes.summary}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {themes.themes.map((t, i) => (
              <button
                key={i}
                onClick={() => onThemeClick(i)}
                className={`text-left border rounded-lg p-3 transition-colors ${
                  activeThemeIndex === i
                    ? 'border-[#005232] bg-[#005232]/5'
                    : 'hover:bg-muted/40'
                }`}
                title="Click to filter the review list to this theme"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{t.theme}</span>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${SENTIMENT_STYLES[t.sentiment]}`}>
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

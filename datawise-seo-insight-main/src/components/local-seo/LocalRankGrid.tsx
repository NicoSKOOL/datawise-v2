import { Button } from '@/components/ui/button';
import { ArrowUp, ArrowDown, Minus, Star, RefreshCw } from 'lucide-react';
import type { LocalTrackedKeyword } from '@/types/local-seo';

interface LocalRankGridProps {
  keywords: LocalTrackedKeyword[];
  loading: boolean;
  onAddKeywords: () => void;
}

function positionColor(position: number | null): string {
  if (position == null) return 'border-red-200 bg-red-50';
  if (position <= 3) return 'border-green-200 bg-green-50';
  if (position <= 7) return 'border-yellow-200 bg-yellow-50';
  if (position <= 10) return 'border-orange-200 bg-orange-50';
  return 'border-red-200 bg-red-50';
}

function positionTextColor(position: number | null): string {
  if (position == null) return 'text-red-400';
  if (position <= 3) return 'text-green-600';
  if (position <= 7) return 'text-yellow-600';
  if (position <= 10) return 'text-orange-600';
  return 'text-red-500';
}

function ChangeArrow({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null) return null;
  const diff = previous - current;
  if (diff === 0) return <Minus className="h-3 w-3 text-gray-400" />;
  if (diff > 0) {
    return (
      <span className="text-[11px] text-green-600 flex items-center gap-0.5 font-medium">
        <ArrowUp className="h-3 w-3" />{diff}
      </span>
    );
  }
  return (
    <span className="text-[11px] text-red-500 flex items-center gap-0.5 font-medium">
      <ArrowDown className="h-3 w-3" />{Math.abs(diff)}
    </span>
  );
}

export default function LocalRankGrid({ keywords, loading, onAddKeywords }: LocalRankGridProps) {
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (keywords.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <p className="mb-1">No keywords tracked yet.</p>
        <p className="text-sm mb-3">Get started by adding keywords to monitor your local pack rankings.</p>
        <Button variant="outline" size="sm" onClick={onAddKeywords}>
          Add Keywords
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {keywords.map((kw) => (
        <div
          key={kw.id}
          className={`rounded-xl border-2 p-4 transition-all hover:shadow-md ${positionColor(kw.pack_position)}`}
        >
          <div className="flex items-start justify-between mb-3">
            <span className={`text-3xl font-extrabold tabular-nums leading-none ${positionTextColor(kw.pack_position)}`}>
              {kw.pack_position ?? '--'}
            </span>
            <ChangeArrow current={kw.pack_position} previous={kw.prev_pack_position} />
          </div>
          <p className="text-sm font-medium leading-tight mb-2 line-clamp-2">{kw.keyword}</p>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {kw.rating != null && (
              <span className="flex items-center gap-0.5">
                <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                {kw.rating}
              </span>
            )}
            {kw.reviews_count != null && (
              <span>{kw.reviews_count} reviews</span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

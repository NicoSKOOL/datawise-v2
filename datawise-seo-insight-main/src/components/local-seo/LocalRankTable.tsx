import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, Minus, Trash2, RefreshCw } from 'lucide-react';
import type { LocalTrackedKeyword } from '@/types/local-seo';

interface LocalRankTableProps {
  keywords: LocalTrackedKeyword[];
  loading: boolean;
  onDelete: (keywordId: string) => void;
  onAddKeywords: () => void;
}

function PositionBadge({ position }: { position: number | null }) {
  if (position == null) {
    return <Badge variant="outline" className="text-red-400 border-red-200 bg-red-50/50">Not in pack</Badge>;
  }
  const cls = position <= 3
    ? 'bg-green-100 text-green-700 hover:bg-green-100 border-green-200 text-base font-bold min-w-[2rem] justify-center'
    : position <= 7
      ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-100 border-yellow-200 text-base font-bold min-w-[2rem] justify-center'
      : position <= 10
        ? 'bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-200 text-base font-bold min-w-[2rem] justify-center'
        : 'bg-red-50 text-red-500 hover:bg-red-50 border-red-200 text-base font-bold min-w-[2rem] justify-center';
  return <Badge className={cls}>{position}</Badge>;
}

function ChangeIndicator({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null) return <Minus className="h-3.5 w-3.5 text-gray-400" />;
  const diff = previous - current; // positive = improved (lower position is better)
  if (diff === 0) return <Minus className="h-3.5 w-3.5 text-gray-400" />;
  if (diff > 0) {
    return (
      <span className="text-xs text-green-600 flex items-center gap-0.5">
        <ArrowUp className="h-3.5 w-3.5" />{diff}
      </span>
    );
  }
  return (
    <span className="text-xs text-red-500 flex items-center gap-0.5">
      <ArrowDown className="h-3.5 w-3.5" />{Math.abs(diff)}
    </span>
  );
}

export default function LocalRankTable({ keywords, loading, onDelete, onAddKeywords }: LocalRankTableProps) {
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
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b text-xs text-muted-foreground uppercase tracking-wider">
            <th className="text-left py-3 px-4 font-medium">Keyword</th>
            <th className="text-center py-3 px-4 font-medium">Pack Position</th>
            <th className="text-center py-3 px-4 font-medium">Change</th>
            <th className="text-center py-3 px-4 font-medium">Rating</th>
            <th className="text-center py-3 px-4 font-medium">Reviews</th>
            <th className="text-center py-3 px-4 font-medium">Last Checked</th>
            <th className="text-right py-3 px-4 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((kw) => (
            <tr key={kw.id} className="border-b last:border-b-0 hover:bg-muted/50">
              <td className="py-3 px-4">
                <span className="font-medium text-sm">{kw.keyword}</span>
              </td>
              <td className="py-3 px-4 text-center">
                <PositionBadge position={kw.pack_position} />
              </td>
              <td className="py-3 px-4 text-center">
                <ChangeIndicator current={kw.pack_position} previous={kw.prev_pack_position} />
              </td>
              <td className="py-3 px-4 text-center">
                <span className="text-sm tabular-nums">{kw.rating ?? '--'}</span>
              </td>
              <td className="py-3 px-4 text-center">
                <span className="text-sm tabular-nums">{kw.reviews_count ?? '--'}</span>
              </td>
              <td className="py-3 px-4 text-center">
                <span className="text-xs text-muted-foreground">
                  {kw.checked_at ? new Date(kw.checked_at).toLocaleDateString() : 'Never'}
                </span>
              </td>
              <td className="py-3 px-4 text-right">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => onDelete(kw.id)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

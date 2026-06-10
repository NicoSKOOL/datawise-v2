import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Star, ArrowUp, ArrowDown, Minus, Users } from 'lucide-react';
import type { GeoGridCompetitor } from '@/types/local-seo';

interface GeoGridCompetitorsListProps {
  competitors: GeoGridCompetitor[];
  previousCompetitors: GeoGridCompetitor[] | null;
  businessName: string | null;
}

function sharePct(c: GeoGridCompetitor): number {
  return c.total_points > 0 ? Math.round((c.appearances / c.total_points) * 100) : 0;
}

function Movement({ current, previous }: { current: GeoGridCompetitor; previous: GeoGridCompetitor | undefined }) {
  if (!previous) {
    return <span className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />new</span>;
  }
  const diff = sharePct(current) - sharePct(previous);
  if (diff === 0) {
    return <span className="text-[10px] text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />0%</span>;
  }
  const up = diff > 0;
  return (
    <span className={`text-[10px] font-medium inline-flex items-center gap-0.5 ${up ? 'text-green-600' : 'text-red-500'}`}>
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}{Math.abs(diff)}%
    </span>
  );
}

// "Who owns your map": competitor share of grid-point top 3 results for the
// latest scan, with movement vs the previous scan of the same keyword.
export default function GeoGridCompetitorsList({ competitors, previousCompetitors, businessName }: GeoGridCompetitorsListProps) {
  if (!competitors || competitors.length === 0) return null;

  const prevByName = new Map((previousCompetitors || []).map(c => [c.name, c]));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4" />
          Map competitors
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {competitors.map((c, i) => {
          const isOwn = c.is_user || (!!businessName && c.name === businessName);
          const pct = sharePct(c);
          return (
            <div
              key={c.name}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 ${
                isOwn ? 'bg-[#005232]/5 border border-[#005232]/40' : ''
              }`}
            >
              <span className="w-5 text-xs font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-sm truncate ${isOwn ? 'font-semibold text-[#005232]' : 'font-medium'}`}>
                    {c.name}
                  </span>
                  {isOwn && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#005232] text-white shrink-0">You</span>
                  )}
                  <Movement current={c} previous={prevByName.get(c.name)} />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${pct}%`, background: isOwn ? '#005232' : '#9ca3af' }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground tabular-nums w-20 text-right">
                    {c.appearances}/{c.total_points} ({pct}%)
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0 w-24">
                <p className="text-xs tabular-nums">
                  {c.avg_position != null ? `avg #${c.avg_position}` : 'avg --'}
                </p>
                <p className="text-[10px] text-muted-foreground flex items-center justify-end gap-0.5">
                  {c.rating != null && (
                    <>
                      <Star className="h-2.5 w-2.5 text-yellow-500 fill-yellow-500" />
                      {c.rating}
                    </>
                  )}
                  {c.reviews != null && <span>({c.reviews})</span>}
                </p>
              </div>
            </div>
          );
        })}
        <p className="text-[10px] text-muted-foreground pt-1">
          Share of grid points where each business appears in the map top 3. Movement compares the previous scan for this keyword.
        </p>
      </CardContent>
    </Card>
  );
}

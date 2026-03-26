import { ArrowUp, ArrowDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TopMover } from '@/types/rank-tracking';

interface TopMoversTableProps {
  movers: TopMover[];
  decliners: TopMover[];
}

function MoverRow({ mover, type }: { mover: TopMover; type: 'up' | 'down' }) {
  const isUp = type === 'up';
  return (
    <div className="flex items-center justify-between py-2.5 border-b last:border-b-0 border-border/40">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{mover.keyword}</p>
        <p className="text-xs text-muted-foreground truncate">{mover.project_name}</p>
      </div>
      <div className="flex items-center gap-1.5 ml-3 shrink-0">
        <span className="text-xs text-muted-foreground tabular-nums">
          {mover.old_position ?? '?'}
        </span>
        <span className="text-xs text-muted-foreground">→</span>
        <span className="text-xs font-medium tabular-nums">
          {mover.new_position ?? '?'}
        </span>
        <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 ${
          isUp ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'
        }`}>
          {isUp ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
          {Math.abs(mover.change)}
        </span>
      </div>
    </div>
  );
}

export default function TopMoversTable({ movers, decliners }: TopMoversTableProps) {
  if (!movers.length && !decliners.length) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 inline-flex items-center gap-0.5">
              <ArrowUp className="h-3 w-3" />
            </span>
            Top Improvers
          </CardTitle>
        </CardHeader>
        <CardContent>
          {movers.length > 0 ? (
            movers.map((m, i) => <MoverRow key={i} mover={m} type="up" />)
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">No improvements yet</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <span className="text-xs font-medium px-1.5 py-0.5 rounded-full bg-red-50 text-red-500 inline-flex items-center gap-0.5">
              <ArrowDown className="h-3 w-3" />
            </span>
            Top Decliners
          </CardTitle>
        </CardHeader>
        <CardContent>
          {decliners.length > 0 ? (
            decliners.map((m, i) => <MoverRow key={i} mover={m} type="down" />)
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">No declines</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

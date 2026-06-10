import { Star } from 'lucide-react';

interface RatingDistributionProps {
  distribution: Record<string, number> | null;
}

// Five horizontal bars, 5 stars down to 1. Accent #005232.
export default function RatingDistribution({ distribution }: RatingDistributionProps) {
  if (!distribution) return null;
  const total = Object.values(distribution).reduce((s, n) => s + (n || 0), 0);
  if (total === 0) return null;

  return (
    <div id="rating-distribution-export" className="border rounded-lg p-4 bg-white space-y-2">
      <p className="text-xs font-medium text-muted-foreground mb-2">Rating distribution</p>
      {['5', '4', '3', '2', '1'].map((star) => {
        const count = distribution[star] || 0;
        const pct = Math.round((count / total) * 100);
        return (
          <div key={star} className="flex items-center gap-2">
            <span className="w-6 text-xs font-medium tabular-nums flex items-center gap-0.5">
              {star}<Star className="h-2.5 w-2.5 text-yellow-500 fill-yellow-500" />
            </span>
            <div className="flex-1 h-2.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: '#005232' }} />
            </div>
            <span className="w-12 text-right text-xs text-muted-foreground tabular-nums">{count}</span>
          </div>
        );
      })}
    </div>
  );
}

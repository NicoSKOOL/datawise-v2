import { Star, TrendingUp, MessageSquare, AlertCircle, ArrowUp, ArrowDown, Minus } from 'lucide-react';
import type { ReviewsResponse } from '@/types/local-seo';

interface HeaderTilesProps {
  data: ReviewsResponse;
  responseRate: number;
  unansweredLowStar: number;
  onUnansweredClick: () => void;
}

function Delta({ value, invert = false, suffix = '', decimals = 0 }: { value: number | null; invert?: boolean; suffix?: string; decimals?: number }) {
  if (value == null) {
    return <span className="text-xs text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />no trend yet</span>;
  }
  const rounded = Math.round(Math.abs(value) * 10 ** decimals) / 10 ** decimals;
  if (rounded === 0) {
    return <span className="text-xs text-gray-400 inline-flex items-center gap-0.5"><Minus className="h-3 w-3" />0{suffix}</span>;
  }
  const isGood = invert ? value < 0 : value > 0;
  const cls = isGood ? 'text-green-600' : 'text-red-500';
  const Icon = value > 0 ? ArrowUp : ArrowDown;
  return (
    <span className={`text-xs font-medium inline-flex items-center gap-0.5 ${cls}`}>
      <Icon className="h-3 w-3" />{rounded}{suffix}
    </span>
  );
}

// Four header tiles, each with a delta vs the previous period (snapshots).
export default function HeaderTiles({ data, responseRate, unansweredLowStar, onUnansweredClick }: HeaderTilesProps) {
  const periodStart = data.snapshots?.period_start ?? null;
  const ratingDelta = data.rating != null && periodStart?.rating != null
    ? data.rating - periodStart.rating : null;
  const responseRateDelta = periodStart?.response_rate != null
    ? responseRate - periodStart.response_rate : null;
  const velocityDelta = data.velocity?.current != null && data.velocity?.previous != null
    ? data.velocity.current - data.velocity.previous : null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="border rounded-lg p-4 bg-white">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5" />Average rating
        </p>
        <p className="text-2xl font-bold mt-1 tabular-nums">{data.rating ?? '--'}</p>
        <Delta value={ratingDelta} decimals={1} />
      </div>

      <div className="border rounded-lg p-4 bg-white">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" />Review velocity
        </p>
        <p className="text-2xl font-bold mt-1 tabular-nums">
          {data.velocity?.current != null ? `+${data.velocity.current}` : '--'}
        </p>
        <p className="text-[11px] text-muted-foreground">new reviews this period</p>
        <Delta value={velocityDelta} suffix=" vs last period" />
      </div>

      <div className="border rounded-lg p-4 bg-white">
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5" />Response rate
        </p>
        <p className="text-2xl font-bold mt-1 tabular-nums">{responseRate}%</p>
        <Delta value={responseRateDelta} suffix="%" />
      </div>

      <button
        onClick={onUnansweredClick}
        className={`border rounded-lg p-4 text-left transition-colors ${
          unansweredLowStar > 0
            ? 'bg-red-50 border-red-200 hover:bg-red-100'
            : 'bg-white hover:bg-muted/40'
        }`}
        title="Click to filter to unanswered reviews rated 3 stars or below"
      >
        <p className={`text-xs flex items-center gap-1.5 ${unansweredLowStar > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
          <AlertCircle className="h-3.5 w-3.5" />Unanswered low-star
        </p>
        <p className={`text-2xl font-bold mt-1 tabular-nums ${unansweredLowStar > 0 ? 'text-red-600' : ''}`}>
          {unansweredLowStar}
        </p>
        <p className={`text-[11px] ${unansweredLowStar > 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
          {unansweredLowStar > 0 ? 'Click to review and reply' : 'All low-star reviews answered'}
        </p>
      </button>
    </div>
  );
}

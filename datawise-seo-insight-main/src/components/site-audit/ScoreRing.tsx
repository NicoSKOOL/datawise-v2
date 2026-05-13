interface Props {
  score: number | null;
  size?: number;
  label?: string;
}

export function ScoreRing({ score, size = 120, label }: Props) {
  const value = score ?? 0;
  const color =
    value >= 90 ? '#16a34a' : value >= 70 ? '#22c55e' : value >= 50 ? '#f59e0b' : '#ef4444';
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeOpacity={0.1}
            strokeWidth={8}
            fill="none"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={color}
            strokeWidth={8}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={score == null ? circumference : offset}
            strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 600ms ease-out' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-3xl font-semibold tabular-nums" style={{ color }}>
            {score == null ? '—' : score}
          </span>
          {label && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
              {label}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export function MiniScore({ score, label }: { score: number | null; label: string }) {
  const value = score ?? 0;
  const color =
    value >= 90 ? 'text-green-600' : value >= 70 ? 'text-green-500' : value >= 50 ? 'text-amber-600' : 'text-red-600';
  const bgColor =
    value >= 90 ? 'bg-green-500' : value >= 70 ? 'bg-green-400' : value >= 50 ? 'bg-amber-500' : 'bg-red-500';

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground truncate">{label}</span>
        <span className={`text-lg font-semibold tabular-nums ${color}`}>
          {score == null ? '—' : score}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full ${bgColor} transition-all`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

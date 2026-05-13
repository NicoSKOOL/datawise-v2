import { Skeleton } from "@/components/ui/skeleton";

interface TableSkeletonProps {
  rows?: number;
  cols?: number;
}

export function TableSkeleton({ rows = 8, cols = 5 }: TableSkeletonProps) {
  const gridStyle = { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } as const;
  return (
    <div className="space-y-3">
      <div className="grid gap-3" style={gridStyle}>
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={`h-${i}`} className="h-4 w-20" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={`r-${r}`} className="grid gap-3" style={gridStyle}>
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={`c-${r}-${c}`} className="h-4 w-full" />
          ))}
        </div>
      ))}
    </div>
  );
}

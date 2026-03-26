import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface TotalKeywordsCardProps {
  totalKeywords: number;
  previousPeriodTotal: number;
  netChange: number;
  percentageChange: number;
  loading?: boolean;
}

export default function TotalKeywordsCard({
  totalKeywords,
  previousPeriodTotal,
  netChange,
  percentageChange,
  loading = false
}: TotalKeywordsCardProps) {
  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Total Keywords Ranked</CardTitle>
          <CardDescription>Keywords in top 100</CardDescription>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-24 mb-2" />
          <Skeleton className="h-4 w-32" />
        </CardContent>
      </Card>
    );
  }

  const getTrendIcon = () => {
    if (netChange > 0) return <TrendingUp className="h-4 w-4" />;
    if (netChange < 0) return <TrendingDown className="h-4 w-4" />;
    return <Minus className="h-4 w-4" />;
  };

  const getTrendColor = () => {
    if (netChange > 0) return "text-green-600 dark:text-green-400";
    if (netChange < 0) return "text-red-600 dark:text-red-400";
    return "text-muted-foreground";
  };

  const getBadgeVariant = () => {
    if (netChange > 0) return "default";
    if (netChange < 0) return "destructive";
    return "secondary";
  };

  const formatChange = () => {
    const sign = netChange > 0 ? "+" : "";
    return `${sign}${netChange} (${sign}${percentageChange.toFixed(1)}%)`;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Total Keywords Ranked</CardTitle>
        <CardDescription>Keywords in top 100</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="flex items-end gap-3">
            <div className="text-5xl font-bold text-primary">
              {totalKeywords}
            </div>
            {netChange !== 0 && (
              <div className={`flex items-center gap-1 mb-2 ${getTrendColor()}`}>
                {getTrendIcon()}
              </div>
            )}
          </div>
          
          {previousPeriodTotal > 0 ? (
            <div className="space-y-2">
              <Badge variant={getBadgeVariant()} className="font-normal">
                {formatChange()} vs previous period
              </Badge>
              <div className="text-sm text-muted-foreground">
                Previously: {previousPeriodTotal} keywords
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No previous period data available
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

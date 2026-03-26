import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
interface AveragePositionCardProps {
  currentAvgPosition: number | null;
  positionChange: number | null;
  weightedAvgPosition: number | null;
  totalKeywords: number;
  loading?: boolean;
}
export default function AveragePositionCard({
  currentAvgPosition,
  positionChange,
  weightedAvgPosition,
  totalKeywords,
  loading
}: AveragePositionCardProps) {
  const getPositionColor = (position: number | null) => {
    if (!position) return "text-muted-foreground";
    if (position <= 10) return "text-green-600";
    if (position <= 20) return "text-yellow-600";
    if (position <= 50) return "text-orange-600";
    return "text-red-600";
  };
  const getTrendIcon = () => {
    if (!positionChange) return <Minus className="h-4 w-4" />;
    // Lower position number is better (negative change is improvement)
    if (positionChange < 0) return <TrendingDown className="h-4 w-4 text-red-600" />;
    if (positionChange > 0) return <TrendingUp className="h-4 w-4 text-green-600" />;
    return <Minus className="h-4 w-4 text-muted-foreground" />;
  };
  const getTrendText = () => {
    if (!positionChange) return "No change";
    const absChange = Math.abs(positionChange);
    // Lower position is better
    if (positionChange > 0) {
      return `↑ ${absChange.toFixed(1)} positions`;
    } else if (positionChange < 0) {
      return `↓ ${absChange.toFixed(1)} positions`;
    }
    return "No change";
  };
  if (loading) {
    return <Card>
        <CardHeader>
          <CardTitle>Average Position</CardTitle>
          <CardDescription>Your site's average ranking position</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse">
            <div className="h-12 bg-muted rounded w-24 mb-2"></div>
            <div className="h-4 bg-muted rounded w-32"></div>
          </div>
        </CardContent>
      </Card>;
  }
  return;
}
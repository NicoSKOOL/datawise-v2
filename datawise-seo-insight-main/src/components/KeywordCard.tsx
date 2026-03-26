import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { TrendingUp, Search, DollarSign, Target } from "lucide-react";

interface KeywordCardProps {
  keyword: string;
  searchVolume: number;
  cpc: number;
  competition: number;
  position?: number | null;
  competitorPosition?: number | null;
  opportunityScore: number;
  priorityLevel: 'quick-win' | 'high-potential' | 'long-term' | 'low-priority';
  intent: 'Commercial' | 'Informational' | 'Navigational';
}

const getPriorityColor = (level: string) => {
  switch (level) {
    case 'quick-win': return 'bg-success text-success-foreground';
    case 'high-potential': return 'bg-primary text-primary-foreground';
    case 'long-term': return 'bg-warning text-warning-foreground';
    default: return 'bg-muted text-muted-foreground';
  }
};

const getIntentColor = (intent: string) => {
  switch (intent) {
    case 'Commercial': return 'bg-chart-1 text-white';
    case 'Informational': return 'bg-chart-2 text-white';
    default: return 'bg-chart-3 text-white';
  }
};

const getOpportunityColor = (score: number) => {
  if (score >= 70) return 'text-success';
  if (score >= 50) return 'text-primary';
  if (score >= 30) return 'text-warning';
  return 'text-muted-foreground';
};

export const KeywordCard = ({
  keyword,
  searchVolume,
  cpc,
  competition,
  position,
  competitorPosition,
  opportunityScore,
  priorityLevel,
  intent
}: KeywordCardProps) => {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-lg leading-tight flex-1">{keyword}</h3>
          <span className={`text-2xl font-bold ${getOpportunityColor(opportunityScore)}`}>
            {Math.round(opportunityScore)}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge className={getPriorityColor(priorityLevel)}>
            {priorityLevel.replace('-', ' ')}
          </Badge>
          <Badge className={getIntentColor(intent)}>
            {intent}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-muted-foreground text-xs">Volume</div>
              <div className="font-semibold">{searchVolume.toLocaleString()}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-muted-foreground text-xs">CPC</div>
              <div className="font-semibold">${cpc.toFixed(2)}</div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="text-muted-foreground text-xs">Competition</div>
              <div className="font-semibold">{Math.round(competition * 100)}%</div>
            </div>
          </div>

          {(position || competitorPosition) && (
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-muted-foreground text-xs">Rank</div>
                <div className="font-semibold">
                  {position ? `#${position}` : competitorPosition ? `Comp: #${competitorPosition}` : 'N/A'}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="pt-2">
          <div className="w-full bg-muted rounded-full h-2">
            <div 
              className="bg-primary h-2 rounded-full transition-all"
              style={{ width: `${Math.min(competition * 100, 100)}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
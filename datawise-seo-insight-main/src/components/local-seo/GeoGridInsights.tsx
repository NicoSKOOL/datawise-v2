import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, AlertTriangle, TrendingUp, Users, MapPin, Star, FileText, Link2, MessageSquare } from 'lucide-react';
import type { GeoGridInsights as InsightsType } from '@/types/local-seo';

const impactColors = {
  high: 'bg-red-100 text-red-800 border-red-200',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  low: 'bg-blue-100 text-blue-800 border-blue-200',
};

const categoryIcons: Record<string, typeof Star> = {
  gbp: Star,
  reviews: MessageSquare,
  content: FileText,
  citations: Link2,
  engagement: Users,
};

function ScoreRing({ score }: { score: number }) {
  const color = score >= 80 ? '#22c55e' : score >= 60 ? '#eab308' : score >= 30 ? '#f97316' : '#ef4444';
  const label = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 30 ? 'Needs Work' : 'Poor';
  const circumference = 2 * Math.PI * 40;
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="currentColor" className="text-muted/20" strokeWidth="8" />
          <circle cx="50" cy="50" r="40" fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            className="transition-all duration-1000" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold" style={{ color }}>{score}</span>
        </div>
      </div>
      <span className="text-xs font-semibold" style={{ color }}>{label}</span>
    </div>
  );
}

interface GeoGridInsightsProps {
  insights: InsightsType;
}

export default function GeoGridInsights({ insights }: GeoGridInsightsProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          AI Visibility Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Score + Headline */}
        <div className="flex items-center gap-5">
          <ScoreRing score={insights.visibility_score} />
          <div className="flex-1">
            <p className="text-sm font-semibold">{insights.headline}</p>
            {insights.strengths.length > 0 && (
              <div className="mt-2 space-y-1">
                {insights.strengths.map((s, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-xs text-green-700">
                    <CheckCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Priority Actions */}
        {insights.priority_actions.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Priority Actions</h4>
            <div className="space-y-2">
              {insights.priority_actions.map((action, i) => {
                const Icon = categoryIcons[action.category] || AlertTriangle;
                return (
                  <div key={i} className="rounded-lg border p-3 space-y-1.5">
                    <div className="flex items-start gap-2">
                      <div className="flex items-center gap-2 flex-1">
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium">{action.title}</span>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 ${impactColors[action.impact]}`}>
                        {action.impact}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground pl-6">{action.description}</p>
                    {action.competitor_insight && (
                      <p className="text-xs text-blue-600 pl-6 flex items-start gap-1">
                        <Users className="h-3 w-3 shrink-0 mt-0.5" />
                        {action.competitor_insight}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Competitor Gap */}
        {insights.competitor_gap && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              Competitor Gap
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">{insights.competitor_gap}</p>
          </div>
        )}

        {/* Geographic Insight */}
        {insights.geographic_insight && (
          <div className="space-y-1.5">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" />
              Geographic Insight
            </h4>
            <p className="text-xs text-muted-foreground leading-relaxed">{insights.geographic_insight}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

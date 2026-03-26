import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface KeywordData {
  keyword: string;
  search_volume: number;
  competition: number;
  cpc: number;
}

interface OpportunityMatrixProps {
  keywords: KeywordData[];
}

export const OpportunityMatrix = ({ keywords }: OpportunityMatrixProps) => {
  const avgVolume = keywords.reduce((sum, k) => sum + k.search_volume, 0) / keywords.length;
  const avgCompetition = keywords.reduce((sum, k) => sum + k.competition, 0) / keywords.length;

  const categorize = (kw: KeywordData) => {
    const highVolume = kw.search_volume >= avgVolume;
    const highCompetition = kw.competition >= avgCompetition;

    if (highVolume && !highCompetition) return 'best';
    if (highVolume && highCompetition) return 'competitive';
    if (!highVolume && !highCompetition) return 'niche';
    return 'avoid';
  };

  const categories = {
    best: keywords.filter(k => categorize(k) === 'best'),
    competitive: keywords.filter(k => categorize(k) === 'competitive'),
    niche: keywords.filter(k => categorize(k) === 'niche'),
    avoid: keywords.filter(k => categorize(k) === 'avoid'),
  };

  const MatrixCard = ({ 
    title, 
    description, 
    keywords, 
    color 
  }: { 
    title: string; 
    description: string; 
    keywords: KeywordData[]; 
    color: string;
  }) => (
    <Card className={`${color} border-2`}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          {title}
          <Badge variant="secondary">{keywords.length}</Badge>
        </CardTitle>
        <CardDescription className="text-foreground/80">
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {keywords.slice(0, 10).map((kw) => (
            <div key={kw.keyword} className="flex items-center justify-between text-sm p-2 bg-background/50 rounded">
              <span className="font-medium truncate flex-1">{kw.keyword}</span>
              <span className="text-muted-foreground ml-2">
                {kw.search_volume.toLocaleString()}
              </span>
            </div>
          ))}
          {keywords.length > 10 && (
            <p className="text-xs text-muted-foreground text-center pt-2">
              + {keywords.length - 10} more keywords
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MatrixCard
          title="🎯 Best Opportunities"
          description="High volume, low competition - target these first!"
          keywords={categories.best}
          color="border-success bg-success/5"
        />
        <MatrixCard
          title="⚔️ Competitive Keywords"
          description="High volume, high competition - require more effort"
          keywords={categories.competitive}
          color="border-warning bg-warning/5"
        />
        <MatrixCard
          title="💎 Niche Opportunities"
          description="Low volume, low competition - easier wins"
          keywords={categories.niche}
          color="border-primary bg-primary/5"
        />
        <MatrixCard
          title="⚠️ Difficult Keywords"
          description="Low volume, high competition - consider avoiding"
          keywords={categories.avoid}
          color="border-muted bg-muted/5"
        />
      </div>
    </div>
  );
};
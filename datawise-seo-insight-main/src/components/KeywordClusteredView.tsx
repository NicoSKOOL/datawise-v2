import { KeywordCard } from "./KeywordCard";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface KeywordData {
  keyword: string;
  search_volume: number;
  cpc: number;
  competition: number;
  my_position?: number | null;
  competitor_position?: number | null;
  opportunity_score: number;
  priority_level: 'quick-win' | 'high-potential' | 'long-term' | 'low-priority';
  intent: 'Commercial' | 'Informational' | 'Navigational';
}

interface KeywordClusteredViewProps {
  keywords: KeywordData[];
}

export const KeywordClusteredView = ({ keywords }: KeywordClusteredViewProps) => {
  const clusters = {
    'quick-win': keywords.filter(k => k.priority_level === 'quick-win'),
    'high-potential': keywords.filter(k => k.priority_level === 'high-potential'),
    'long-term': keywords.filter(k => k.priority_level === 'long-term'),
    'low-priority': keywords.filter(k => k.priority_level === 'low-priority'),
  };

  const clusterInfo = {
    'quick-win': {
      title: 'Quick Wins',
      description: 'High opportunity score - target these first',
      count: clusters['quick-win'].length
    },
    'high-potential': {
      title: 'High Potential',
      description: 'Strong opportunities worth pursuing',
      count: clusters['high-potential'].length
    },
    'long-term': {
      title: 'Long Term',
      description: 'Good keywords for future content strategy',
      count: clusters['long-term'].length
    },
    'low-priority': {
      title: 'Low Priority',
      description: 'Consider these only after exhausting other opportunities',
      count: clusters['low-priority'].length
    }
  };

  return (
    <div className="space-y-8">
      {Object.entries(clusters).map(([level, clusterKeywords]) => {
        if (clusterKeywords.length === 0) return null;
        
        const info = clusterInfo[level as keyof typeof clusterInfo];
        
        return (
          <div key={level}>
            <Card className="mb-4">
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  {info.title}
                  <span className="text-sm font-normal text-muted-foreground">
                    {info.count} keywords
                  </span>
                </CardTitle>
                <CardDescription>{info.description}</CardDescription>
              </CardHeader>
            </Card>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {clusterKeywords.map((kw) => (
                <KeywordCard
                  key={kw.keyword}
                  keyword={kw.keyword}
                  searchVolume={kw.search_volume}
                  cpc={kw.cpc}
                  competition={kw.competition}
                  position={kw.my_position}
                  competitorPosition={kw.competitor_position}
                  opportunityScore={kw.opportunity_score}
                  priorityLevel={kw.priority_level}
                  intent={kw.intent}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};
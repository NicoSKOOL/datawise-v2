import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSearchParams } from 'react-router-dom';
import DomainRankOverview from './DomainRankOverview';
import RankedKeywords from './RankedKeywords';
import KeywordGapAnalysis from './KeywordGapAnalysis';
import BulkTrafficEstimation from './BulkTrafficEstimation';
import CompetitorsDomain from './CompetitorsDomain';

const competitorAnalysisTabs = new Set([
  'domain-rank',
  'ranked-keywords',
  'gap-analysis',
  'traffic',
  'competitors',
]);

export default function CompetitorAnalysis() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = requestedTab && competitorAnalysisTabs.has(requestedTab) ? requestedTab : 'domain-rank';

  function handleTabChange(value: string) {
    const nextParams = new URLSearchParams(searchParams);

    if (value === 'domain-rank') {
      nextParams.delete('tab');
    } else {
      nextParams.set('tab', value);
    }

    setSearchParams(nextParams, { replace: true });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Competitor Analysis</h1>
        <p className="text-muted-foreground">Analyze and benchmark against your competitors</p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="inline-flex h-auto max-w-full flex-wrap justify-start">
          <TabsTrigger value="domain-rank">Domain Rank</TabsTrigger>
          <TabsTrigger value="ranked-keywords">Ranked Keywords</TabsTrigger>
          <TabsTrigger value="gap-analysis">Gap Analysis</TabsTrigger>
          <TabsTrigger value="traffic">Traffic</TabsTrigger>
          <TabsTrigger value="competitors">Competitors</TabsTrigger>
        </TabsList>

        <TabsContent forceMount value="domain-rank" className="mt-6">
          <DomainRankOverview />
        </TabsContent>
        <TabsContent forceMount value="ranked-keywords" className="mt-6">
          <RankedKeywords />
        </TabsContent>
        <TabsContent forceMount value="gap-analysis" className="mt-6">
          <KeywordGapAnalysis />
        </TabsContent>
        <TabsContent forceMount value="traffic" className="mt-6">
          <BulkTrafficEstimation />
        </TabsContent>
        <TabsContent forceMount value="competitors" className="mt-6">
          <CompetitorsDomain />
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import DomainRankOverview from './DomainRankOverview';
import RankedKeywords from './RankedKeywords';
import KeywordGapAnalysis from './KeywordGapAnalysis';
import BulkTrafficEstimation from './BulkTrafficEstimation';
import CompetitorsDomain from './CompetitorsDomain';

export default function CompetitorAnalysis() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Competitor Analysis</h1>
        <p className="text-muted-foreground">Analyze and benchmark against your competitors</p>
      </div>

      <Tabs defaultValue="domain-rank" className="w-full">
        <TabsList>
          <TabsTrigger value="domain-rank">Domain Rank</TabsTrigger>
          <TabsTrigger value="ranked-keywords">Ranked Keywords</TabsTrigger>
          <TabsTrigger value="gap-analysis">Gap Analysis</TabsTrigger>
          <TabsTrigger value="traffic">Traffic</TabsTrigger>
          <TabsTrigger value="competitors">Competitors</TabsTrigger>
        </TabsList>

        <TabsContent value="domain-rank" className="mt-6">
          <DomainRankOverview />
        </TabsContent>
        <TabsContent value="ranked-keywords" className="mt-6">
          <RankedKeywords />
        </TabsContent>
        <TabsContent value="gap-analysis" className="mt-6">
          <KeywordGapAnalysis />
        </TabsContent>
        <TabsContent value="traffic" className="mt-6">
          <BulkTrafficEstimation />
        </TabsContent>
        <TabsContent value="competitors" className="mt-6">
          <CompetitorsDomain />
        </TabsContent>
      </Tabs>
    </div>
  );
}

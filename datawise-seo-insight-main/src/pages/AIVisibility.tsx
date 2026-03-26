import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AIOverview from './AIOverview';
import PeopleAlsoAsk from './PeopleAlsoAsk';
import OnPageSEO from './OnPageSEO';

export default function AIVisibility() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Visibility & SERP Analysis</h1>
        <p className="text-muted-foreground">Monitor your presence in AI search results and audit your pages</p>
      </div>

      <Tabs defaultValue="ai-overview" className="w-full">
        <TabsList>
          <TabsTrigger value="ai-overview">AI Search Tracker</TabsTrigger>
          <TabsTrigger value="people-also-ask">People Also Ask</TabsTrigger>
          <TabsTrigger value="onpage-seo">On-Page SEO</TabsTrigger>
        </TabsList>

        <TabsContent value="ai-overview" className="mt-6">
          <AIOverview />
        </TabsContent>
        <TabsContent value="people-also-ask" className="mt-6">
          <PeopleAlsoAsk />
        </TabsContent>
        <TabsContent value="onpage-seo" className="mt-6">
          <OnPageSEO />
        </TabsContent>
      </Tabs>
    </div>
  );
}

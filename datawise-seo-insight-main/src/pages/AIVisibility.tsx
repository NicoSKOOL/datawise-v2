import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SiteAuditErrorBoundary } from '@/components/site-audit/ErrorBoundary';
import { useTabParam } from '@/hooks/use-tab-param';
import AIOverview from './AIOverview';
import BrandTracker from './BrandTracker';

export default function AIVisibility() {
  const [activeTab, setActiveTab] = useTabParam('ai-overview');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Visibility & SERP Analysis</h1>
        <p className="text-muted-foreground">Monitor your presence in AI search results and audit your pages</p>
      </div>

      <SiteAuditErrorBoundary>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="ai-overview">AI Search Tracker</TabsTrigger>
          <TabsTrigger value="brand-tracker">Brand Tracker</TabsTrigger>
        </TabsList>

        <TabsContent value="ai-overview" className="mt-6">
          <AIOverview />
        </TabsContent>
        <TabsContent value="brand-tracker" className="mt-6">
          <BrandTracker />
        </TabsContent>
      </Tabs>
      </SiteAuditErrorBoundary>
    </div>
  );
}

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SiteAuditErrorBoundary } from '@/components/site-audit/ErrorBoundary';
import { useTabParam } from '@/hooks/use-tab-param';
import PerformanceTab from '@/components/ai-visibility/PerformanceTab';
import AIOverview from './AIOverview';
import BrandTracker from './BrandTracker';

export default function AIVisibility() {
  const [activeTab, setActiveTab] = useTabParam('performance');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">AI Visibility</h1>
        <p className="text-muted-foreground">How AI search answers cite your site, tracked week over week</p>
      </div>

      <SiteAuditErrorBoundary>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="ai-overview">Instant Check</TabsTrigger>
          <TabsTrigger value="brand-tracker">Brand Tracker</TabsTrigger>
        </TabsList>

        <TabsContent value="performance" className="mt-6">
          <PerformanceTab />
        </TabsContent>
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

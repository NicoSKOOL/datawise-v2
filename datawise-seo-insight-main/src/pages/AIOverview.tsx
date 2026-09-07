import { useState } from 'react';
import TrackQueryInline from '@/components/ai-visibility/TrackQueryInline';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Brain, Loader2 } from 'lucide-react';
import { locationOptions, languageOptions } from '@/lib/dataForSeoLocations';
import { usePersistentState } from '@/hooks/use-persistent-state';
import { AI_ENGINE_LABELS, AI_ENGINE_ORDER, type AIEngine } from '@/lib/ai-tracking';
import { fetchEngineCheck, type EngineCheckResponse } from '@/lib/ai-engines';
import EngineResultPanel from '@/components/ai-visibility/EngineResultPanel';
import EngineLogo from '@/components/rank-tracking/ai/EngineLogo';

type Results = Partial<Record<AIEngine, EngineCheckResponse>>;

// Instant Check: one prompt, one engine at a time, through the shared engine
// layer (POST /api/ai/engine-check). ChatGPT and Gemini answers come from the
// real interface via DataForSEO's LLM Scraper; Google AI Mode from the SERP;
// Perplexity from its API.
export default function AIOverview() {
  const [activeTab, setActiveTab] = usePersistentState<AIEngine>('ai-overview:engine', 'google_ai_mode');
  const [keyword, setKeyword] = usePersistentState<string>('ai-overview:keyword', '');
  const [brandDomain, setBrandDomain] = usePersistentState<string>('ai-overview:brand', '');
  const [location, setLocation] = usePersistentState<string>('ai-overview:location', '2840');
  const [language, setLanguage] = usePersistentState<string>('ai-overview:language', 'en');
  const [results, setResults] = usePersistentState<Results>('ai-overview:results', {});
  const [loading, setLoading] = useState<AIEngine | null>(null);
  const { toast } = useToast();

  const analyze = async (engine: AIEngine) => {
    if (!keyword.trim()) {
      toast({ title: 'Enter a prompt', description: 'Type the question you want to check.', variant: 'destructive' });
      return;
    }
    setLoading(engine);
    try {
      const res = await fetchEngineCheck({
        engine,
        query: keyword.trim(),
        location_code: parseInt(location, 10),
        language_code: language,
        brand_domain: brandDomain.trim() || undefined,
      });
      setResults((prev) => ({ ...prev, [engine]: res }));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Try again in a moment.';
      toast({ title: `${AI_ENGINE_LABELS[engine]} check failed`, description: message, variant: 'destructive' });
    } finally {
      setLoading(null);
    }
  };

  return (
    <div className="container mx-auto space-y-8 p-6">
      <div className="space-y-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold">
          <Brain className="h-8 w-8 text-primary" />
          AI Search Tracker
        </h1>
        <p className="text-muted-foreground">
          See what Google AI Mode, ChatGPT, Gemini and Perplexity actually answer, and whether they cite you.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Instant Check</CardTitle>
          <CardDescription>One prompt, one engine at a time. ChatGPT and Gemini answers come from the real interface.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-4">
          <div className="space-y-2 md:col-span-2">
            <Label>Prompt</Label>
            <Input
              placeholder="best crm for small business"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && analyze(activeTab)}
            />
          </div>
          <div className="space-y-2">
            <Label>Your domain (optional)</Label>
            <Input placeholder="yourdomain.com" value={brandDomain} onChange={(e) => setBrandDomain(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {locationOptions.map((o) => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {languageOptions.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as AIEngine)} className="w-full">
        <TabsList className="inline-flex">
          {AI_ENGINE_ORDER.map((engine) => (
            <TabsTrigger key={engine} value={engine} className="gap-2">
              <EngineLogo engine={engine} />
              {AI_ENGINE_LABELS[engine]}
            </TabsTrigger>
          ))}
        </TabsList>
        {AI_ENGINE_ORDER.map((engine) => (
          <TabsContent key={engine} value={engine} className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => analyze(engine)} disabled={loading !== null}>
                {loading === engine
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Checking {AI_ENGINE_LABELS[engine]}</>
                  : `Check ${AI_ENGINE_LABELS[engine]}`}
              </Button>
              <span className="text-xs text-muted-foreground">1 credit per check. Results are cached for an hour.</span>
            </div>
            {results[engine] && loading !== engine && <TrackQueryInline query={keyword} />}
            {results[engine] ? (
              <EngineResultPanel result={results[engine]!} query={keyword} brandDomain={brandDomain} />
            ) : (
              <Card>
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  Run a check to see the {AI_ENGINE_LABELS[engine]} answer, its sources and whether you appear.
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

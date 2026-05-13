import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Brain, Search, ExternalLink, TrendingUp, Eye, Target, BarChart3, ChevronDown, Lightbulb, Sparkles } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import { useToast } from "@/hooks/use-toast";
import { locationOptions } from "@/lib/dataForSeoLocations";

function safeDomainFromUrl(url: string): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace('www.', '').toLowerCase(); }
  catch { return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase(); }
}

function extractAISearchResponse(result: any): { content: string; annotations: any[]; reasoning: string; fanOutQueries: string[] } {
  let reasoning = '';
  const fanOutQueries: string[] = result?.fan_out_queries || [];

  // Extract reasoning from items
  if (result?.items) {
    for (const item of result.items) {
      if (item.type === 'reasoning' && item.sections) {
        reasoning = item.sections.map((s: any) => s.text || '').join('\n\n');
      }
    }
  }

  // Try structure 1: items[0].sections[0]
  const messageItem = result?.items?.find((i: any) => i.type === 'message') || result?.items?.[0];
  const section = messageItem?.sections?.[0];
  if (section?.annotations?.length || section?.text) {
    // Collect all annotations from all sections
    const allAnnotations: any[] = [];
    for (const sec of (messageItem?.sections || [])) {
      if (sec.annotations) allAnnotations.push(...sec.annotations);
    }
    return { content: section.text || '', annotations: allAnnotations.length ? allAnnotations : (section.annotations || []), reasoning, fanOutQueries };
  }
  // Try structure 2: items[0] with references/annotations directly
  if (messageItem) {
    const annotations = messageItem.references || messageItem.annotations || messageItem.citations || [];
    const content = messageItem.text || messageItem.content || '';
    if (annotations.length || content) {
      return { content, annotations, reasoning, fanOutQueries };
    }
    // Try all items for annotations
    const allAnnotations: any[] = [];
    let allContent = '';
    for (const item of result.items) {
      if (item.type === 'reasoning') continue;
      if (item.sections) {
        for (const sec of item.sections) {
          if (sec.text) allContent += (allContent ? '\n\n' : '') + sec.text;
          if (sec.annotations) allAnnotations.push(...sec.annotations);
        }
      }
      if (item.references) allAnnotations.push(...item.references);
      if (item.annotations) allAnnotations.push(...item.annotations);
    }
    if (allAnnotations.length || allContent) {
      return { content: allContent, annotations: allAnnotations, reasoning, fanOutQueries };
    }
  }
  return { content: '', annotations: [], reasoning, fanOutQueries };
}

interface LLMEngineTabProps {
  engineName: string;
  engineLabel: string;
  keyword: string;
  brandDomain: string;
  location: string;
  loading: boolean;
  showLocation?: boolean;
  onAnalyze: () => void;
  onKeywordChange: (keyword: string) => void;
  onBrandDomainChange: (domain: string) => void;
  onLocationChange: (location: string) => void;
  onRunFanOutQuery?: (query: string) => void;
}

interface LLMEngineMetrics {
  isBrandCited: boolean;
  citationCount: number;
  citationPosition: number | null;
  topCompetitors: string[];
}

interface LLMEngineResults {
  content: string;
  sources: Array<{
    title: string;
    url: string;
    domain: string;
    isBrand: boolean;
  }>;
  reasoning?: string;
  fanOutQueries?: string[];
  reasoningTokens?: number;
}

export function useLLMEngine(fetchFn: (params: any) => Promise<any>) {
  const [results, setResults] = useState<LLMEngineResults | null>(null);
  const [metrics, setMetrics] = useState<LLMEngineMetrics | null>(null);
  const { toast } = useToast();

  const analyze = async (keyword: string, brandDomain: string, extraParams?: Record<string, any>) => {
    const data: any = await fetchFn({ keyword: keyword.trim(), ...extraParams });

    if (data?.tasks?.[0]?.result?.[0]) {
      const result = data.tasks[0].result[0];
      const { content, annotations, reasoning, fanOutQueries } = extractAISearchResponse(result);

      const brandDomainLower = safeDomainFromUrl(brandDomain) || brandDomain.replace('www.', '').toLowerCase();

      const citedSources = annotations.map((annotation: any) => {
        const url = annotation.url || '';
        const domain = safeDomainFromUrl(url);
        return {
          title: annotation.title || 'Untitled',
          url,
          domain,
          isBrand: domain ? domain.includes(brandDomainLower) : false
        };
      });

      const brandCitations = citedSources.filter((source: any) => source.isBrand);
      const isBrandCited = brandCitations.length > 0;
      const citationCount = brandCitations.length;
      const citationPosition = isBrandCited
        ? citedSources.findIndex((s: any) => s.isBrand) + 1
        : null;

      const competitorDomains = citedSources
        .filter((source: any) => !source.isBrand && source.domain)
        .map((source: any) => source.domain)
        .filter((domain: string, index: number, self: string[]) => self.indexOf(domain) === index)
        .slice(0, 3);

      setMetrics({ isBrandCited, citationCount, citationPosition, topCompetitors: competitorDomains });
      setResults({
        content,
        sources: citedSources,
        reasoning,
        fanOutQueries,
        reasoningTokens: result.reasoning_tokens || 0,
      });

      toast({
        title: "Analysis Complete",
        description: `Found ${citedSources.length} sources`,
      });

      return { metrics: { isBrandCited, citationCount, citationPosition, topCompetitors: competitorDomains }, results: { content, sources: citedSources, reasoning, fanOutQueries } };
    } else {
      setResults({ content: '', sources: [] });
      setMetrics({ isBrandCited: false, citationCount: 0, citationPosition: null, topCompetitors: [] });
      toast({ title: "No Results", description: "No response returned for this query. Try a different keyword." });
      return null;
    }
  };

  const reset = () => {
    setResults(null);
    setMetrics(null);
  };

  return { results, metrics, analyze, reset };
}

export default function LLMEngineTab({
  engineName,
  engineLabel,
  keyword,
  brandDomain,
  location,
  loading,
  showLocation = false,
  onAnalyze,
  onKeywordChange,
  onBrandDomainChange,
  onLocationChange,
  onRunFanOutQuery,
}: LLMEngineTabProps & {
  metrics: LLMEngineMetrics | null;
  results: LLMEngineResults | null;
  activeTab: string;
}) {
  return null; // Not used as a standalone component
}

export function LLMEngineForm({
  engineLabel,
  keyword,
  brandDomain,
  location,
  loading,
  showLocation = false,
  useReasoning = false,
  onAnalyze,
  onKeywordChange,
  onBrandDomainChange,
  onLocationChange,
  onReasoningChange,
}: {
  engineLabel: string;
  keyword: string;
  brandDomain: string;
  location: string;
  loading: boolean;
  showLocation?: boolean;
  useReasoning?: boolean;
  onAnalyze: () => void;
  onKeywordChange: (v: string) => void;
  onBrandDomainChange: (v: string) => void;
  onLocationChange: (v: string) => void;
  onReasoningChange?: (v: boolean) => void;
}) {
  const reasoningModels: Record<string, string> = {
    ChatGPT: 'o4-mini',
    Claude: 'claude-sonnet-4-0',
    Gemini: 'gemini-2.5-flash',
    Perplexity: 'sonar-reasoning-pro',
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{engineLabel} Analysis</CardTitle>
        <CardDescription>
          Track brand citations in {engineLabel} AI responses
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`grid grid-cols-1 ${showLocation ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-4`}>
          <div className="space-y-2">
            <Label>Keyword</Label>
            <Input
              placeholder="Enter keyword to analyze"
              value={keyword}
              onChange={(e) => onKeywordChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAnalyze()}
            />
          </div>

          <div className="space-y-2">
            <Label>Your Brand Domain</Label>
            <Input
              placeholder="example.com"
              value={brandDomain}
              onChange={(e) => onBrandDomainChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && onAnalyze()}
            />
          </div>

          {showLocation && (
            <div className="space-y-2">
              <Label>Location</Label>
              <Select value={location} onValueChange={onLocationChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locationOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value.toString()}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {onReasoningChange && (
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-amber-50/50 dark:bg-amber-950/10 border-amber-200 dark:border-amber-800">
            <Lightbulb className="h-4 w-4 text-amber-600 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Label htmlFor={`reasoning-${engineLabel}`} className="text-sm font-medium cursor-pointer">
                  Show AI Reasoning
                </Label>
                <Switch
                  id={`reasoning-${engineLabel}`}
                  checked={useReasoning}
                  onCheckedChange={onReasoningChange}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {useReasoning
                  ? `Using ${reasoningModels[engineLabel] || 'reasoning model'}: reveals the model's step-by-step thinking process`
                  : 'Enable to see why the AI cites (or ignores) specific sources'}
              </p>
            </div>
          </div>
        )}

        <Button
          onClick={onAnalyze}
          disabled={loading || !keyword.trim() || !brandDomain.trim()}
          className="w-full md:w-auto"
        >
          {useReasoning ? <Lightbulb className="mr-2 h-4 w-4" /> : <Search className="mr-2 h-4 w-4" />}
          {loading ? "Analyzing..." : useReasoning ? `Analyze ${engineLabel} with Reasoning` : `Analyze ${engineLabel}`}
        </Button>
      </CardContent>
    </Card>
  );
}

export function LLMLoadingState({ engineLabel, keyword }: { engineLabel: string; keyword: string }) {
  return (
    <Card className="animate-fade-in">
      <CardContent className="py-12">
        <div className="flex flex-col items-center justify-center space-y-4">
          <div className="relative">
            <Brain className="h-16 w-16 text-primary animate-pulse" />
            <Search className="h-8 w-8 text-primary absolute -bottom-2 -right-2 animate-bounce" />
          </div>
          <div className="text-center space-y-2">
            <h3 className="text-lg font-semibold">Analyzing {engineLabel}</h3>
            <p className="text-sm text-muted-foreground">
              Researching "{keyword}" in {engineLabel}...
            </p>
            <div className="flex items-center justify-center gap-1 mt-4">
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
              <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function LLMMetricsCards({ metrics }: { metrics: LLMEngineMetrics }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Brand Cited
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${metrics.isBrandCited ? 'text-success' : 'text-destructive'}`}>
            {metrics.isBrandCited ? 'Yes' : 'No'}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Citation Count
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{metrics.citationCount}</div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Target className="h-4 w-4" />
            Citation Position
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-primary">
            {metrics.citationPosition ? `#${metrics.citationPosition}` : "--"}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Top Competitor
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm font-bold truncate">
            {metrics.topCompetitors?.[0] || "--"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Extract sentences from reasoning text that mention a specific domain
function extractReasoningForDomain(reasoning: string, domain: string): string[] {
  if (!reasoning || !domain) return [];
  const cleanDomain = domain.replace('www.', '').toLowerCase();
  // Split on sentence boundaries (period/newline followed by space or newline)
  const sentences = reasoning.split(/(?<=[.!?\n])\s+/).filter(Boolean);
  const matches: string[] = [];

  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i].toLowerCase();
    if (sentence.includes(cleanDomain) || sentence.includes(cleanDomain.split('.')[0])) {
      // Include surrounding context (previous + current + next sentence)
      const context = [
        i > 0 ? sentences[i - 1] : '',
        sentences[i],
        i < sentences.length - 1 ? sentences[i + 1] : '',
      ].filter(Boolean).join(' ').trim();
      matches.push(context);
    }
  }

  // Deduplicate overlapping contexts
  const unique: string[] = [];
  for (const match of matches) {
    if (!unique.some(u => u.includes(match) || match.includes(u))) {
      unique.push(match);
    }
  }
  return unique.slice(0, 3);
}

// Extract high-level citation factors from reasoning text
function extractCitationFactors(reasoning: string): Array<{ factor: string; description: string }> {
  if (!reasoning) return [];
  const lower = reasoning.toLowerCase();
  const factors: Array<{ factor: string; description: string }> = [];

  const patterns: Array<{ keywords: string[]; factor: string; description: string }> = [
    { keywords: ['authorit', 'expert', 'credib', 'trust', 'reputa'], factor: 'Authority & Expertise', description: 'The model evaluated source credibility and domain expertise' },
    { keywords: ['recent', 'up-to-date', 'latest', 'current', '2024', '2025', '2026', 'fresh'], factor: 'Content Freshness', description: 'Recent or updated content was prioritized' },
    { keywords: ['relevan', 'match', 'topic', 'specific', 'direct'], factor: 'Topical Relevance', description: 'Content closely matching the query topic was favored' },
    { keywords: ['compre', 'thorough', 'detailed', 'in-depth', 'complete'], factor: 'Content Depth', description: 'Comprehensive, detailed content was preferred' },
    { keywords: ['data', 'statistic', 'research', 'study', 'evidence', 'number', 'percent'], factor: 'Data & Evidence', description: 'Sources with supporting data or research were valued' },
    { keywords: ['first-hand', 'original', 'primary', 'unique', 'proprietary'], factor: 'Original Content', description: 'First-hand or original information was prioritized' },
    { keywords: ['review', 'comparison', 'versus', 'vs', 'rank', 'best', 'top'], factor: 'Comparative Value', description: 'Content offering comparisons or rankings was useful' },
    { keywords: ['official', 'government', '.gov', '.edu', 'institution'], factor: 'Official Sources', description: 'Official or institutional sources were trusted' },
    { keywords: ['user', 'experience', 'testimonial', 'customer', 'real-world'], factor: 'User Experience', description: 'Real-world user experiences informed the response' },
    { keywords: ['structure', 'organized', 'clear', 'well-written', 'format'], factor: 'Content Structure', description: 'Well-organized, clearly structured content was preferred' },
  ];

  for (const { keywords, factor, description } of patterns) {
    if (keywords.some(kw => lower.includes(kw))) {
      factors.push({ factor, description });
    }
  }

  return factors.slice(0, 6);
}

export function LLMResultsDisplay({
  engineLabel,
  keyword,
  results,
  onRunFanOutQuery,
}: {
  engineLabel: string;
  keyword: string;
  results: LLMEngineResults;
  onRunFanOutQuery?: (query: string) => void;
}) {
  const [rawReasoningOpen, setRawReasoningOpen] = useState(false);

  if (!results.content && (!results.sources || results.sources.length === 0)) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Search className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold">No Citations Found</h3>
          <p className="text-sm text-muted-foreground mt-2">
            {engineLabel} did not cite any sources for this query. Try a broader or more popular keyword.
          </p>
        </CardContent>
      </Card>
    );
  }

  const citationFactors = results.reasoning ? extractCitationFactors(results.reasoning) : [];

  return (
    <div className="space-y-4">
      {/* Citation Intelligence: only when reasoning is available */}
      {results.reasoning && (
        <Card className="border-amber-300 dark:border-amber-700">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <Lightbulb className="h-5 w-5" />
              Citation Intelligence
            </CardTitle>
            <CardDescription>
              Why {engineLabel} chose these sources for "{keyword}"
              {results.reasoningTokens ? (
                <span className="ml-1">({results.reasoningTokens} reasoning tokens)</span>
              ) : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Citation Factors */}
            {citationFactors.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-3">Ranking Factors Detected in Reasoning</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {citationFactors.map(({ factor, description }, i) => (
                    <div key={i} className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-800/50">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                      <div>
                        <p className="text-sm font-medium">{factor}</p>
                        <p className="text-xs text-muted-foreground">{description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Per-Source Reasoning */}
            {results.sources && results.sources.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-3">Why Each Source Was Cited</h4>
                <div className="space-y-3">
                  {results.sources.map((source, index) => {
                    const reasoningExcerpts = extractReasoningForDomain(results.reasoning || '', source.domain);
                    return (
                      <div
                        key={index}
                        className={`border rounded-lg overflow-hidden ${source.isBrand ? 'border-primary bg-primary/5' : 'border-border'}`}
                      >
                        <div className="flex items-center justify-between p-3 bg-muted/50">
                          <div className="flex items-center gap-2 min-w-0">
                            <Badge variant="outline" className="shrink-0">#{index + 1}</Badge>
                            {source.isBrand && <Badge variant="default" className="shrink-0">Your Brand</Badge>}
                            <span className="font-medium text-sm truncate">{source.title}</span>
                            <span className="text-xs text-muted-foreground shrink-0">{source.domain}</span>
                          </div>
                          <Button variant="ghost" size="sm" asChild className="shrink-0">
                            <a href={source.url} target="_blank" rel="noopener noreferrer">
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </Button>
                        </div>
                        {reasoningExcerpts.length > 0 ? (
                          <div className="p-3 border-t border-amber-200/50 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/10">
                            <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1.5 flex items-center gap-1">
                              <Lightbulb className="h-3 w-3" />
                              AI's reasoning about this source:
                            </p>
                            {reasoningExcerpts.map((excerpt, ei) => (
                              <p key={ei} className="text-xs text-muted-foreground italic leading-relaxed mt-1">
                                "{excerpt}"
                              </p>
                            ))}
                          </div>
                        ) : (
                          <div className="p-3 border-t bg-muted/30">
                            <p className="text-xs text-muted-foreground italic">
                              No specific reasoning found for this domain. The model may have cited it based on general relevance to the query.
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Raw Reasoning Chain (collapsible) */}
            <Collapsible open={rawReasoningOpen} onOpenChange={setRawReasoningOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="w-full justify-between">
                  <span className="flex items-center gap-2">
                    <Brain className="h-4 w-4" />
                    Full Reasoning Chain
                  </span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${rawReasoningOpen ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 bg-muted/50 border p-4 rounded-lg text-xs font-mono whitespace-pre-wrap max-h-96 overflow-y-auto leading-relaxed">
                  {results.reasoning}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </CardContent>
        </Card>
      )}

      {/* Main Response Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            {engineLabel} Response
          </CardTitle>
          <CardDescription>
            {engineLabel} generated response for "{keyword}"
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {results.content && (
            <div className="bg-muted p-4 rounded-lg prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown skipHtml>{results.content}</ReactMarkdown>
            </div>
          )}

          {/* Sources (non-reasoning view, without per-source reasoning) */}
          {!results.reasoning && results.sources?.length > 0 && (
            <div>
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Sources Cited ({results.sources.length})
              </h4>
              <div className="space-y-3">
                {results.sources.map((source, index) => (
                  <div
                    key={index}
                    className={`border rounded-lg p-3 ${source.isBrand ? 'border-primary bg-primary/5' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">#{index + 1}</Badge>
                          {source.isBrand && (
                            <Badge variant="default">Your Brand</Badge>
                          )}
                        </div>
                        <h5 className="font-medium text-sm mt-2">{source.title}</h5>
                        <p className="text-xs text-muted-foreground">{source.domain}</p>
                      </div>
                      <Button variant="ghost" size="sm" asChild>
                        <a href={source.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {results.fanOutQueries && results.fanOutQueries.length > 0 && (
            <div>
              <h4 className="font-medium mb-3 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-violet-500" />
                Related AI Questions ({results.fanOutQueries.length})
              </h4>
              <div className="flex flex-wrap gap-2">
                {results.fanOutQueries.map((query, index) => (
                  <Badge
                    key={index}
                    variant="secondary"
                    className={onRunFanOutQuery ? "cursor-pointer hover:bg-primary/20 transition-colors" : ""}
                    onClick={() => onRunFanOutQuery?.(query)}
                  >
                    {query}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

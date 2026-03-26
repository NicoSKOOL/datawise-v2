import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Brain, Search, ExternalLink, TrendingUp, Eye, Target, Award, BarChart3, Info } from "lucide-react";
import ReactMarkdown from 'react-markdown';
import { useToast } from "@/hooks/use-toast";
import { fetchGoogleAIMode, fetchChatGPTSearch, fetchPerplexitySearch } from "@/lib/dataforseo";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";

function safeDomainFromUrl(url: string): string {
  if (!url) return '';
  try { return new URL(url).hostname.replace('www.', '').toLowerCase(); }
  catch { return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase(); }
}

function extractAISearchResponse(result: any): { content: string; annotations: any[] } {
  // Try structure 1: items[0].sections[0] (expected DataForSEO structure)
  const section = result?.items?.[0]?.sections?.[0];
  if (section?.annotations?.length || section?.text) {
    return { content: section.text || '', annotations: section.annotations || [] };
  }
  // Try structure 2: items[0] with references/annotations directly
  const firstItem = result?.items?.[0];
  if (firstItem) {
    const annotations = firstItem.references || firstItem.annotations || firstItem.citations || [];
    const content = firstItem.text || firstItem.content || '';
    if (annotations.length || content) {
      return { content, annotations };
    }
    // Try all items for annotations
    const allAnnotations: any[] = [];
    let allContent = '';
    for (const item of result.items) {
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
      return { content: allContent, annotations: allAnnotations };
    }
  }
  return { content: '', annotations: [] };
}

interface AIModeBrandMetrics {
  brand_cited: boolean;
  brand_citation_count: number;
  brand_citation_position?: number;
  competitor_domains: Array<{
    domain: string;
    citation_count: number;
  }>;
}

export default function AIOverview() {
  const [activeTab, setActiveTab] = useState<'ai-mode' | 'chatgpt' | 'perplexity'>('ai-mode');
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("2826");
  const [language, setLanguage] = useState("en");
  const [device, setDevice] = useState("desktop");
  const [os, setOS] = useState("windows");
  const [brandDomain, setBrandDomain] = useState("");
  const [loading, setLoading] = useState(false);
  
  // AI Mode results
  const [aiModeResults, setAiModeResults] = useState<any>(null);
  const [aiModeSources, setAiModeSources] = useState<any[]>([]);
  const [aiModeBrandMetrics, setAiModeBrandMetrics] = useState<AIModeBrandMetrics | null>(null);
  
  // ChatGPT and Perplexity results
  const [chatGptResults, setChatGptResults] = useState<any>(null);
  const [chatGptMetrics, setChatGptMetrics] = useState<any>(null);
  const [perplexityResults, setPerplexityResults] = useState<any>(null);
  const [perplexityMetrics, setPerplexityMetrics] = useState<any>(null);
  
  const { toast } = useToast();

  const handleAnalyzeAIMode = async () => {
    if (!keyword.trim()) {
      toast({
        title: "Error",
        description: "Please enter a keyword to analyze",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setAiModeResults(null);
    setAiModeSources([]);
    setAiModeBrandMetrics(null);

    try {
      const selectedLocation = locationOptions.find(loc => loc.value.toString() === location);
      
      const data: any = await fetchGoogleAIMode({
        keyword: keyword.trim(),
        location_name: selectedLocation?.label || "United States",
        device,
        os
      });

      if (data?.tasks?.[0]?.result?.[0]) {
        const result = data.tasks[0].result[0];
        setAiModeResults(result);

        const aiItem = result.items?.find((item: any) => item.type === 'ai_overview' || item.type === 'ai_mode');
        if (aiItem) {
          const allSources: any[] = [];

          // Collect references from the ai_overview item itself
          if (aiItem.references && Array.isArray(aiItem.references)) {
            allSources.push(...aiItem.references);
          }
          // Also collect from nested items
          if (aiItem.items && Array.isArray(aiItem.items)) {
            aiItem.items.forEach((item: any) => {
              if (item.references && Array.isArray(item.references)) {
                allSources.push(...item.references);
              }
            });
          }

          // Remove duplicates based on URL
          const uniqueSources = allSources.filter((source, index, self) =>
            index === self.findIndex((s) => s.url === source.url)
          );
          
          setAiModeSources(uniqueSources);

          if (brandDomain.trim()) {
            const cleanBrand = brandDomain.trim().toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, '');
            
            const brandSources = uniqueSources.filter(source => 
              source.domain?.toLowerCase().includes(cleanBrand) || 
              source.url?.toLowerCase().includes(cleanBrand)
            );

            const competitorDomains = uniqueSources
              .filter(source => 
                !(source.domain?.toLowerCase().includes(cleanBrand) || source.url?.toLowerCase().includes(cleanBrand))
              )
              .reduce((acc: any[], source) => {
                const existing = acc.find(item => item.domain === source.domain);
                if (existing) {
                  existing.citation_count++;
                } else if (source.domain) {
                  acc.push({ domain: source.domain, citation_count: 1 });
                }
                return acc;
              }, [])
              .sort((a, b) => b.citation_count - a.citation_count)
              .slice(0, 5);

            setAiModeBrandMetrics({
              brand_cited: brandSources.length > 0,
              brand_citation_count: brandSources.length,
              brand_citation_position: brandSources.length > 0 
                ? uniqueSources.findIndex(source => 
                    source.domain?.toLowerCase().includes(cleanBrand) || 
                    source.url?.toLowerCase().includes(cleanBrand)
                  ) + 1 
                : undefined,
              competitor_domains: competitorDomains
            });
          }
        }

        toast({
          title: "Analysis Complete",
          description: "Google AI Mode results retrieved successfully",
        });
      } else {
        setAiModeResults({ empty: true });
        toast({ title: "No AI Mode Result", description: "Google did not return an AI Mode response for this query. Try a different keyword." });
      }
    } catch (error: any) {
      console.error('AI Mode Error:', error);
      if (error?.message?.includes('out_of_credits')) {
        toast({
          title: "Out of Credits",
          description: "You have run out of credits. Please upgrade to continue.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to analyze AI Mode",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeChatGpt = async () => {
    if (!keyword.trim() || !brandDomain.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter both a keyword and your brand domain",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setChatGptResults(null);
    setChatGptMetrics(null);

    try {
      const data: any = await fetchChatGPTSearch({ keyword: keyword.trim() });

      if (data?.tasks?.[0]?.result?.[0]) {
        const result = data.tasks[0].result[0];
        const { content, annotations } = extractAISearchResponse(result);

        const brandDomainLower = safeDomainFromUrl(brandDomain) || brandDomain.replace('www.', '').toLowerCase();

        const citedSources = annotations.map((annotation: any) => {
          const url = annotation.url || '';
          const domain = safeDomainFromUrl(url);
          return {
            title: annotation.title || 'Untitled',
            url: url,
            domain: domain,
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

        setChatGptMetrics({
          isBrandCited,
          citationCount,
          citationPosition,
          topCompetitors: competitorDomains
        });

        setChatGptResults({
          content: content,
          sources: citedSources
        });

        toast({
          title: "Analysis Complete",
          description: `Found ${citedSources.length} sources in ChatGPT response`,
        });
      } else {
        setChatGptResults({ content: '', sources: [] });
        setChatGptMetrics({ isBrandCited: false, citationCount: 0, citationPosition: null, topCompetitors: [] });
        toast({ title: "No Results", description: "ChatGPT did not return a response for this query. Try a different keyword." });
      }
    } catch (error: any) {
      if (error?.message?.includes('out_of_credits')) {
        toast({
          title: "Out of Credits",
          description: "You have run out of credits. Please upgrade to continue.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to analyze ChatGPT search",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzePerplexity = async () => {
    if (!keyword.trim() || !brandDomain.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter both a keyword and your brand domain",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    setPerplexityResults(null);
    setPerplexityMetrics(null);

    try {
      const selectedLocation = locationOptions.find(loc => loc.value.toString() === location);
      
      const data: any = await fetchPerplexitySearch({
        keyword: keyword.trim(),
        location_code: selectedLocation?.value || 2840
      });

      if (data?.tasks?.[0]?.result?.[0]) {
        const result = data.tasks[0].result[0];
        const { content, annotations } = extractAISearchResponse(result);

        const brandDomainLower = safeDomainFromUrl(brandDomain) || brandDomain.replace('www.', '').toLowerCase();

        const citedSources = annotations.map((annotation: any) => {
          const url = annotation.url || '';
          const domain = safeDomainFromUrl(url);
          return {
            title: annotation.title || 'Untitled',
            url: url,
            domain: domain,
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

        setPerplexityMetrics({
          isBrandCited,
          citationCount,
          citationPosition,
          topCompetitors: competitorDomains
        });

        setPerplexityResults({
          content: content,
          sources: citedSources
        });

        toast({
          title: "Analysis Complete",
          description: `Found ${citedSources.length} sources in Perplexity response`,
        });
      } else {
        setPerplexityResults({ content: '', sources: [] });
        setPerplexityMetrics({ isBrandCited: false, citationCount: 0, citationPosition: null, topCompetitors: [] });
        toast({ title: "No Results", description: "Perplexity did not return a response for this query. Try a different keyword." });
      }
    } catch (error: any) {
      if (error?.message?.includes('out_of_credits')) {
        toast({
          title: "Out of Credits",
          description: "You have run out of credits. Please upgrade to continue.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Error",
          description: error.message || "Failed to analyze Perplexity search",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-8">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Brain className="h-8 w-8 text-primary" />
          AI Search Tracker
        </h1>
        <p className="text-muted-foreground">
          Analyze Google AI Mode, ChatGPT, and Perplexity to track brand visibility in AI-powered search
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="ai-mode">Google AI Mode</TabsTrigger>
          <TabsTrigger value="chatgpt">ChatGPT Search</TabsTrigger>
          <TabsTrigger value="perplexity">Perplexity</TabsTrigger>
        </TabsList>

        {/* Google AI Mode Tab */}
        <TabsContent value="ai-mode" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Google AI Mode Analysis</CardTitle>
              <CardDescription>
                Analyze brand visibility and citations in Google AI Mode search results
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ai-keyword">Keyword</Label>
                  <Input
                    id="ai-keyword"
                    placeholder="Enter keyword to analyze"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyzeAIMode()}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-brand">Your Brand Domain</Label>
                  <Input
                    id="ai-brand"
                    placeholder="example.com"
                    value={brandDomain}
                    onChange={(e) => setBrandDomain(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyzeAIMode()}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-location">Location</Label>
                  <Select value={location} onValueChange={setLocation}>
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
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ai-device">Device</Label>
                  <Select value={device} onValueChange={setDevice}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select device" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="desktop">Desktop</SelectItem>
                      <SelectItem value="mobile">Mobile</SelectItem>
                      <SelectItem value="tablet">Tablet</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-os">Operating System</Label>
                  <Select value={os} onValueChange={setOS}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select OS" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="windows">Windows</SelectItem>
                      <SelectItem value="macos">macOS</SelectItem>
                      <SelectItem value="linux">Linux</SelectItem>
                      <SelectItem value="android">Android</SelectItem>
                      <SelectItem value="ios">iOS</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Button 
                onClick={handleAnalyzeAIMode} 
                disabled={loading || !keyword.trim()}
                className="w-full md:w-auto"
              >
                <Search className="mr-2 h-4 w-4" />
                {loading ? "Analyzing..." : "Analyze AI Mode"}
              </Button>
            </CardContent>
          </Card>

          {loading && activeTab === "ai-mode" && (
            <Card className="animate-fade-in">
              <CardContent className="py-12">
                <div className="flex flex-col items-center justify-center space-y-4">
                  <div className="relative">
                    <Brain className="h-16 w-16 text-primary animate-pulse" />
                    <Search className="h-8 w-8 text-primary absolute -bottom-2 -right-2 animate-bounce" />
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="text-lg font-semibold">Analyzing AI Mode</h3>
                    <p className="text-sm text-muted-foreground">
                      Researching "{keyword}" in Google AI Mode...
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
          )}

          {aiModeBrandMetrics && !loading && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Brand Cited
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${aiModeBrandMetrics.brand_cited ? 'text-success' : 'text-destructive'}`}>
                    {aiModeBrandMetrics.brand_cited ? 'Yes' : 'No'}
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
                  <div className="text-2xl font-bold">
                    {aiModeBrandMetrics.brand_citation_count}
                  </div>
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
                    {aiModeBrandMetrics.brand_citation_position ? `#${aiModeBrandMetrics.brand_citation_position}` : "--"}
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
                    {aiModeBrandMetrics.competitor_domains?.[0]?.domain || "--"}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {aiModeResults && !loading && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  AI Mode Response
                </CardTitle>
                <CardDescription>
                  Google AI Mode generated response for "{keyword}"
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="bg-muted p-4 rounded-lg prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown>{aiModeResults.content || aiModeResults.markdown || ''}</ReactMarkdown>
                </div>

                {aiModeSources.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Sources Cited ({aiModeSources.length})
                    </h4>
                    <div className="space-y-3">
                      {aiModeSources.map((source: any, index: number) => {
                        const isBrandSource = brandDomain && source.domain?.toLowerCase().includes(brandDomain.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, ''));
                        return (
                          <div 
                            key={index} 
                            className={`border rounded-lg p-3 ${isBrandSource ? 'border-primary bg-primary/5' : ''}`}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline">#{index + 1}</Badge>
                                  {isBrandSource && (
                                    <Badge variant="default">Your Brand</Badge>
                                  )}
                                </div>
                                <h5 className="font-medium text-sm mt-2">{source.title || source.domain}</h5>
                                <p className="text-xs text-muted-foreground">{source.domain}</p>
                                {source.text && (
                                  <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{source.text}</p>
                                )}
                              </div>
                              <Button variant="ghost" size="sm" asChild>
                                <a href={source.url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-3 w-3" />
                                </a>
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ChatGPT Search Tab */}
        <TabsContent value="chatgpt" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>ChatGPT Search Analysis</CardTitle>
              <CardDescription>
                Track brand mentions in ChatGPT web-connected search responses
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="chatgpt-keyword">Keyword</Label>
                  <Input
                    id="chatgpt-keyword"
                    placeholder="Enter keyword to analyze"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyzeChatGpt()}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="chatgpt-brand">Your Brand Domain</Label>
                  <Input
                    id="chatgpt-brand"
                    placeholder="example.com"
                    value={brandDomain}
                    onChange={(e) => setBrandDomain(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyzeChatGpt()}
                  />
                </div>
              </div>
              
              <Button 
                onClick={handleAnalyzeChatGpt} 
                disabled={loading || !keyword.trim() || !brandDomain.trim()}
                className="w-full md:w-auto"
              >
                <Search className="mr-2 h-4 w-4" />
                {loading ? "Analyzing..." : "Analyze ChatGPT Search"}
              </Button>
            </CardContent>
          </Card>

          {loading && activeTab === "chatgpt" && (
            <Card className="animate-fade-in">
              <CardContent className="py-12">
                <div className="flex flex-col items-center justify-center space-y-4">
                  <div className="relative">
                    <Brain className="h-16 w-16 text-primary animate-pulse" />
                    <Search className="h-8 w-8 text-primary absolute -bottom-2 -right-2 animate-bounce" />
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="text-lg font-semibold">Analyzing ChatGPT Search</h3>
                    <p className="text-sm text-muted-foreground">
                      Researching "{keyword}" in ChatGPT...
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
          )}

          {chatGptMetrics && !loading && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Brand Cited
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${chatGptMetrics.isBrandCited ? 'text-success' : 'text-destructive'}`}>
                    {chatGptMetrics.isBrandCited ? 'Yes' : 'No'}
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
                  <div className="text-2xl font-bold">
                    {chatGptMetrics.citationCount}
                  </div>
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
                    {chatGptMetrics.citationPosition ? `#${chatGptMetrics.citationPosition}` : "--"}
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
                    {chatGptMetrics.topCompetitors?.[0] || "--"}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {chatGptResults && !loading && !chatGptResults.content && (!chatGptResults.sources || chatGptResults.sources.length === 0) && (
            <Card>
              <CardContent className="py-12 text-center">
                <Search className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
                <h3 className="text-lg font-semibold">No Citations Found</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  ChatGPT did not cite any sources for this query. Try a broader or more popular keyword.
                </p>
              </CardContent>
            </Card>
          )}

          {chatGptResults && !loading && (chatGptResults.content || chatGptResults.sources?.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  ChatGPT Response
                </CardTitle>
                <CardDescription>
                  ChatGPT generated response for "{keyword}"
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {chatGptResults.content && (
                <div className="bg-muted p-4 rounded-lg prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown>{chatGptResults.content}</ReactMarkdown>
                </div>
                )}

                {chatGptResults.sources?.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Sources Cited ({chatGptResults.sources.length})
                    </h4>
                    <div className="space-y-3">
                      {chatGptResults.sources.map((source: any, index: number) => (
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
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Perplexity Tab */}
        <TabsContent value="perplexity" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Perplexity Analysis</CardTitle>
              <CardDescription>
                Track brand citations in Perplexity AI responses
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="perplexity-keyword">Keyword</Label>
                  <Input
                    id="perplexity-keyword"
                    placeholder="Enter keyword to analyze"
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyzePerplexity()}
                  />
                </div>
                
                <div className="space-y-2">
                  <Label htmlFor="perplexity-brand">Your Brand Domain</Label>
                  <Input
                    id="perplexity-brand"
                    placeholder="example.com"
                    value={brandDomain}
                    onChange={(e) => setBrandDomain(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAnalyzePerplexity()}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="perplexity-location">Location</Label>
                  <Select value={location} onValueChange={setLocation}>
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
              </div>
              
              <Button 
                onClick={handleAnalyzePerplexity} 
                disabled={loading || !keyword.trim() || !brandDomain.trim()}
                className="w-full md:w-auto"
              >
                <Search className="mr-2 h-4 w-4" />
                {loading ? "Analyzing..." : "Analyze Perplexity"}
              </Button>
            </CardContent>
          </Card>

          {loading && activeTab === "perplexity" && (
            <Card className="animate-fade-in">
              <CardContent className="py-12">
                <div className="flex flex-col items-center justify-center space-y-4">
                  <div className="relative">
                    <Brain className="h-16 w-16 text-primary animate-pulse" />
                    <Search className="h-8 w-8 text-primary absolute -bottom-2 -right-2 animate-bounce" />
                  </div>
                  <div className="text-center space-y-2">
                    <h3 className="text-lg font-semibold">Analyzing Perplexity</h3>
                    <p className="text-sm text-muted-foreground">
                      Researching "{keyword}" in Perplexity...
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
          )}

          {perplexityMetrics && !loading && (
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Eye className="h-4 w-4" />
                    Brand Cited
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-bold ${perplexityMetrics.isBrandCited ? 'text-success' : 'text-destructive'}`}>
                    {perplexityMetrics.isBrandCited ? 'Yes' : 'No'}
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
                  <div className="text-2xl font-bold">
                    {perplexityMetrics.citationCount}
                  </div>
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
                    {perplexityMetrics.citationPosition ? `#${perplexityMetrics.citationPosition}` : "--"}
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
                    {perplexityMetrics.topCompetitors?.[0] || "--"}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {perplexityResults && !loading && !perplexityResults.content && (!perplexityResults.sources || perplexityResults.sources.length === 0) && (
            <Card>
              <CardContent className="py-12 text-center">
                <Search className="h-12 w-12 mx-auto text-muted-foreground/40 mb-4" />
                <h3 className="text-lg font-semibold">No Citations Found</h3>
                <p className="text-sm text-muted-foreground mt-2">
                  Perplexity did not cite any sources for this query. Try a broader or more popular keyword.
                </p>
              </CardContent>
            </Card>
          )}

          {perplexityResults && !loading && (perplexityResults.content || perplexityResults.sources?.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Brain className="h-5 w-5" />
                  Perplexity Response
                </CardTitle>
                <CardDescription>
                  Perplexity generated response for "{keyword}"
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {perplexityResults.content && (
                <div className="bg-muted p-4 rounded-lg prose prose-sm max-w-none dark:prose-invert">
                  <ReactMarkdown>{perplexityResults.content}</ReactMarkdown>
                </div>
                )}

                {perplexityResults.sources?.length > 0 && (
                  <div>
                    <h4 className="font-medium mb-3 flex items-center gap-2">
                      <TrendingUp className="h-4 w-4" />
                      Sources Cited ({perplexityResults.sources.length})
                    </h4>
                    <div className="space-y-3">
                      {perplexityResults.sources.map((source: any, index: number) => (
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
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

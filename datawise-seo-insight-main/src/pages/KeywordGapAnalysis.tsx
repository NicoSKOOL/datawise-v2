import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchKeywordGapAnalysis } from "@/lib/dataforseo";
import { toast } from "sonner";
import { Loader2, TrendingDown, Target, Award, LayoutGrid, Table as TableIcon, Grid3x3 } from "lucide-react";
import { DataTable } from "@/components/DataTable";
import { KeywordClusteredView } from "@/components/KeywordClusteredView";
import { OpportunityMatrix } from "@/components/OpportunityMatrix";
import { AIAnalysisSummary } from "@/components/AIAnalysisSummary";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";

interface KeywordData {
  keyword: string;
  search_volume: number;
  cpc: number;
  competition: number;
  my_position?: number | null;
  competitor_position?: number | null;
}

interface ProcessedKeywordData extends KeywordData {
  opportunity_score: number;
  priority_level: 'quick-win' | 'high-potential' | 'long-term' | 'low-priority';
  intent: 'Commercial' | 'Informational' | 'Navigational';
}

const KeywordGapAnalysis = () => {
  const [myDomain, setMyDomain] = useState("");
  const [competitorDomain, setCompetitorDomain] = useState("");
  const [location, setLocation] = useState("2840");
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);
  const [activeTab, setActiveTab] = useState("gaps");
  const [viewMode, setViewMode] = useState<'cards' | 'table' | 'matrix'>('cards');

  // Calculate opportunity score for each keyword
  const calculateOpportunityScore = (keyword: KeywordData): number => {
    const volumeScore = Math.min(keyword.search_volume / 1000, 100);
    const competitionScore = (1 - keyword.competition) * 100;
    const cpcScore = Math.min(keyword.cpc * 10, 100);
    const rankScore = keyword.my_position 
      ? Math.max(0, 100 - keyword.my_position * 2)
      : keyword.competitor_position
      ? Math.max(0, 100 - keyword.competitor_position * 2)
      : 50;
    
    return (volumeScore * 0.3) + (competitionScore * 0.3) + (cpcScore * 0.2) + (rankScore * 0.2);
  };

  // Determine priority level based on opportunity score
  const getPriorityLevel = (score: number): 'quick-win' | 'high-potential' | 'long-term' | 'low-priority' => {
    if (score >= 70) return 'quick-win';
    if (score >= 50) return 'high-potential';
    if (score >= 30) return 'long-term';
    return 'low-priority';
  };

  // Detect search intent from keyword
  const detectIntent = (keyword: string): 'Commercial' | 'Informational' | 'Navigational' => {
    const lowerKeyword = keyword.toLowerCase();
    if (/\b(buy|price|cost|cheap|discount|deal|purchase|shop|order)\b/i.test(lowerKeyword)) {
      return 'Commercial';
    }
    if (/\b(how|what|why|when|where|guide|tutorial|learn|tips|best|top|review|compare|vs)\b/i.test(lowerKeyword)) {
      return 'Informational';
    }
    return 'Navigational';
  };

  // Process keywords with clustering
  const processKeywords = (keywords: KeywordData[]): ProcessedKeywordData[] => {
    return keywords.map(kw => ({
      ...kw,
      opportunity_score: calculateOpportunityScore(kw),
      priority_level: getPriorityLevel(calculateOpportunityScore(kw)),
      intent: detectIntent(kw.keyword)
    }));
  };

  // Memoized processed data
  const processedGaps = useMemo(() => 
    results?.gaps ? processKeywords(results.gaps) : [], 
    [results?.gaps]
  );
  
  const processedBothRanking = useMemo(() => 
    results?.both_ranking ? processKeywords(results.both_ranking) : [], 
    [results?.both_ranking]
  );
  
  const processedAdvantages = useMemo(() => 
    results?.advantages ? processKeywords(results.advantages) : [], 
    [results?.advantages]
  );

  const handleAnalyze = async () => {
    if (!myDomain || !competitorDomain) {
      toast.error("Please enter both your domain and competitor domain");
      return;
    }

    setLoading(true);
    setResults(null);

    try {
      const data: any = await fetchKeywordGapAnalysis({
        my_domain: myDomain,
        competitor_domain: competitorDomain,
        location_code: parseInt(location),
        language_code: language,
      });

      if (data?.error) {
        console.error("Analysis error:", data);
        toast.error(data.error + (data.details ? '\n\n' + data.details : ''), { duration: 8000 });
        setLoading(false);
        return;
      }

      console.log("Gap Analysis Results:", data);
      setResults(data);
      toast.success("Gap analysis completed successfully!");
    } catch (error: any) {
      console.error("Error analyzing keyword gaps:", error);
      toast.error(error.message || "Failed to analyze keyword gaps");
    } finally {
      setLoading(false);
    }
  };

  // Format data for table view
  const formatTableData = (keywords: ProcessedKeywordData[], type: 'gaps' | 'both' | 'advantages') => {
    return keywords.map(kw => {
      const base = {
        Keyword: kw.keyword,
        "Search Volume": kw.search_volume.toLocaleString(),
        "CPC": `$${kw.cpc.toFixed(2)}`,
        "Competition": `${Math.round(kw.competition * 100)}%`,
        "Opportunity Score": Math.round(kw.opportunity_score),
        "Priority": kw.priority_level.replace('-', ' '),
        "Intent": kw.intent,
      };

      if (type === 'gaps') {
        return { ...base, "Competitor Position": kw.competitor_position || 'N/A' };
      } else if (type === 'both') {
        return { 
          ...base, 
          "Your Position": kw.my_position || 'N/A',
          "Competitor Position": kw.competitor_position || 'N/A'
        };
      } else {
        return { ...base, "Your Position": kw.my_position || 'N/A' };
      }
    });
  };

  return (
    <div className="container mx-auto py-8 space-y-8">
      <div>
        <h1 className="text-4xl font-bold mb-2">Keyword Gap Analysis</h1>
        <p className="text-muted-foreground">
          Discover keyword opportunities by comparing your site against competitors
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Analysis Configuration</CardTitle>
          <CardDescription>
            Compare two domains to find keyword opportunities
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Your Domain</label>
              <Input
                placeholder="example.com"
                value={myDomain}
                onChange={(e) => setMyDomain(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Competitor Domain</label>
              <Input
                placeholder="competitor.com"
                value={competitorDomain}
                onChange={(e) => setCompetitorDomain(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Location</label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger>
                  <SelectValue />
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
            <div className="space-y-2">
              <label className="text-sm font-medium">Language</label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {languageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button onClick={handleAnalyze} disabled={loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              "Analyze Keyword Gaps"
            )}
          </Button>
        </CardContent>
      </Card>

      {results && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Keyword Gaps</CardTitle>
                <TrendingDown className="h-4 w-4 text-destructive" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{results.metrics.total_gaps}</div>
                <p className="text-xs text-muted-foreground">
                  Opportunities to target
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Shared Keywords</CardTitle>
                <Target className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{results.metrics.total_shared}</div>
                <p className="text-xs text-muted-foreground">
                  Competitive overlap
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Your Advantages</CardTitle>
                <Award className="h-4 w-4 text-success" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{results.metrics.total_advantages}</div>
                <p className="text-xs text-muted-foreground">
                  Unique keywords
                </p>
              </CardContent>
            </Card>
          </div>

          <AIAnalysisSummary
            myDomain={results.my_domain}
            competitorDomain={results.competitor_domain}
            bothRanking={results.both_ranking}
            gaps={results.gaps}
            advantages={results.advantages}
          />

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="gaps">
                Keyword Gaps ({results.metrics.total_gaps})
              </TabsTrigger>
              <TabsTrigger value="both">
                Both Ranking ({results.metrics.total_shared})
              </TabsTrigger>
              <TabsTrigger value="advantages">
                Your Advantages ({results.metrics.total_advantages})
              </TabsTrigger>
            </TabsList>

            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant={viewMode === 'cards' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('cards')}
              >
                <LayoutGrid className="h-4 w-4 mr-2" />
                Cards
              </Button>
              <Button
                variant={viewMode === 'table' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('table')}
              >
                <TableIcon className="h-4 w-4 mr-2" />
                Table
              </Button>
              <Button
                variant={viewMode === 'matrix' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setViewMode('matrix')}
              >
                <Grid3x3 className="h-4 w-4 mr-2" />
                Matrix
              </Button>
            </div>

            <TabsContent value="gaps" className="mt-6">
              <div className="mb-6 p-4 bg-muted/50 rounded-lg border">
                <p className="text-lg font-medium text-foreground">
                  Keywords <span className="text-primary font-semibold">{results.competitor_domain}</span> ranks for and <span className="text-primary font-semibold">{results.my_domain}</span> does not
                </p>
              </div>
              {viewMode === 'cards' && <KeywordClusteredView keywords={processedGaps} />}
              {viewMode === 'table' && (
                <DataTable
                  data={formatTableData(processedGaps, 'gaps')}
                  title="Keyword Gap Opportunities"
                  description="Keywords your competitor ranks for, but you don't"
                  loading={false}
                />
              )}
              {viewMode === 'matrix' && <OpportunityMatrix keywords={processedGaps} />}
            </TabsContent>

            <TabsContent value="both" className="mt-6">
              <div className="mb-6 p-4 bg-muted/50 rounded-lg border">
                <p className="text-lg font-medium text-foreground">
                  Keywords both <span className="text-primary font-semibold">{results.my_domain}</span> and <span className="text-primary font-semibold">{results.competitor_domain}</span> rank for
                </p>
              </div>
              {viewMode === 'cards' && <KeywordClusteredView keywords={processedBothRanking} />}
              {viewMode === 'table' && (
                <DataTable
                  data={formatTableData(processedBothRanking, 'both')}
                  title="Shared Keywords"
                  description="Keywords where both domains rank"
                  loading={false}
                />
              )}
              {viewMode === 'matrix' && <OpportunityMatrix keywords={processedBothRanking} />}
            </TabsContent>

            <TabsContent value="advantages" className="mt-6">
              <div className="mb-6 p-4 bg-muted/50 rounded-lg border">
                <p className="text-lg font-medium text-foreground">
                  Keywords <span className="text-primary font-semibold">{results.my_domain}</span> ranks for and <span className="text-primary font-semibold">{results.competitor_domain}</span> does not
                </p>
              </div>
              {viewMode === 'cards' && <KeywordClusteredView keywords={processedAdvantages} />}
              {viewMode === 'table' && (
                <DataTable
                  data={formatTableData(processedAdvantages, 'advantages')}
                  title="Your Unique Advantages"
                  description="Keywords only you rank for"
                  loading={false}
                />
              )}
              {viewMode === 'matrix' && <OpportunityMatrix keywords={processedAdvantages} />}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
};

export default KeywordGapAnalysis;

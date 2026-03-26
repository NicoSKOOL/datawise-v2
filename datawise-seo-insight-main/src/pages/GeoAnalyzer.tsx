import { useState } from "react";
import { fetchGeoAnalyzer } from "@/lib/dataforseo";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import LoadingAnimation from "@/components/LoadingAnimation";
import { 
  MapPin, 
  Globe, 
  Search, 
  AlertCircle, 
  CheckCircle, 
  AlertTriangle, 
  TrendingUp,
  Copy,
  ChevronDown,
  ExternalLink,
  FileText,
  Users,
  ShoppingCart,
  Code,
  Lightbulb,
  Target,
  Star,
  Building2
} from "lucide-react";

interface ElementScore {
  id: number;
  name: string;
  category: string;
  score: number;
  maxScore: number;
  status: "critical" | "important" | "optimize" | "excellent";
  finding: string;
  recommendation: string;
  example: string;
  impact: string;
}

interface CategoryScore {
  score: number;
  max: number;
  percentage: number;
}

interface SchemaInfo {
  present: boolean;
  complete: boolean;
  missing: string[];
}

interface GeoAnalysisResult {
  url: string;
  analyzedAt: string;
  geoScore: number;
  grade: string;
  rawScore: number;
  maxScore: number;
  categories: {
    content_uniqueness: CategoryScore;
    local_trust_signals: CategoryScore;
    transactional_elements: CategoryScore;
    technical_schema: CategoryScore;
  };
  elements: ElementScore[];
  recommendations: {
    critical: Array<{
      element: string;
      currentScore: number;
      issue: string;
      recommendation: string;
      example: string;
      impact: string;
    }>;
    important: Array<{
      element: string;
      currentScore: number;
      issue: string;
      recommendation: string;
      example: string;
      impact: string;
    }>;
    optimize: Array<{
      element: string;
      currentScore: number;
      issue: string;
      recommendation: string;
      example: string;
      impact: string;
    }>;
  };
  schemaAnalysis: {
    LocalBusiness: SchemaInfo;
    Service: SchemaInfo;
    FAQPage: SchemaInfo;
    AggregateRating: SchemaInfo;
  };
  keyStats: {
    wordCount: number;
    h1Count: number;
    internalLinks: number;
    externalLinks: number;
    images: number;
    imagesWithAlt: number;
    phoneDetected: boolean;
  };
}

const CATEGORY_INFO = {
  content_uniqueness: {
    name: "Content Uniqueness",
    icon: FileText,
    description: "Unique, location-specific content signals"
  },
  local_trust_signals: {
    name: "Local Trust Signals",
    icon: Users,
    description: "Team, testimonials, and local proof"
  },
  transactional_elements: {
    name: "Transactional Elements",
    icon: ShoppingCart,
    description: "CTAs, pricing, and contact info"
  },
  technical_schema: {
    name: "Technical & Schema",
    icon: Code,
    description: "Structured data implementation"
  }
};


export default function GeoAnalyzer() {
  const [url, setUrl] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [targetLocation, setTargetLocation] = useState("");
  const [primaryService, setPrimaryService] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<GeoAnalysisResult | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");

  const validateUrl = (url: string): boolean => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const runAnalysis = async () => {
    if (!url) {
      toast.error("Please enter a URL to analyze");
      return;
    }

    const urlToAnalyze = url.startsWith("http") ? url : `https://${url}`;
    
    if (!validateUrl(urlToAnalyze)) {
      toast.error("Please enter a valid URL");
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const data: any = await fetchGeoAnalyzer({
        url: urlToAnalyze,
        businessName: businessName || undefined,
        targetLocation: targetLocation || undefined,
        primaryService: primaryService || undefined,
      });

      setResult(data);
      toast.success(`Analysis complete! GEO Score: ${data.geoScore}`);
    } catch (error: any) {
      console.error("GEO Analysis error:", error);
      toast.error(error.message || "Failed to analyze page");
    } finally {
      setIsLoading(false);
    }
  };

  const getGradeColor = (grade: string): string => {
    switch (grade) {
      case "A": return "text-green-500";
      case "B": return "text-blue-500";
      case "C": return "text-yellow-500";
      case "D": return "text-orange-500";
      default: return "text-red-500";
    }
  };

  const getGradeBgColor = (grade: string): string => {
    switch (grade) {
      case "A": return "bg-green-500/10 border-green-500/30";
      case "B": return "bg-blue-500/10 border-blue-500/30";
      case "C": return "bg-yellow-500/10 border-yellow-500/30";
      case "D": return "bg-orange-500/10 border-orange-500/30";
      default: return "bg-red-500/10 border-red-500/30";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "critical": return <AlertCircle className="h-4 w-4 text-red-500" />;
      case "important": return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "optimize": return <TrendingUp className="h-4 w-4 text-blue-500" />;
      default: return <CheckCircle className="h-4 w-4 text-green-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "critical": return <Badge variant="destructive">Critical</Badge>;
      case "important": return <Badge className="bg-yellow-500/20 text-yellow-700 border-yellow-500/30">Important</Badge>;
      case "optimize": return <Badge className="bg-blue-500/20 text-blue-700 border-blue-500/30">Optimize</Badge>;
      default: return <Badge className="bg-green-500/20 text-green-700 border-green-500/30">Excellent</Badge>;
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  const getCategoryIcon = (category: string) => {
    const Icon = CATEGORY_INFO[category as keyof typeof CATEGORY_INFO]?.icon || FileText;
    return <Icon className="h-5 w-5" />;
  };

  return (
    <div className="container mx-auto py-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <MapPin className="h-8 w-8 text-primary" />
          <h1 className="text-3xl font-bold">Service Page GEO Analyzer</h1>
        </div>
        <p className="text-muted-foreground">
          Optimize your service pages for AI search engines (ChatGPT, Perplexity, Google AI Overviews)
        </p>
      </div>


      {/* Input Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Analyze Your Service Page
          </CardTitle>
          <CardDescription>
            Enter a service/location page URL to analyze against 16 GEO optimization criteria
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="https://example.com/plumbing-boston"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="flex-1"
              onKeyDown={(e) => e.key === "Enter" && runAnalysis()}
            />
            <Button onClick={runAnalysis} disabled={isLoading}>
              {isLoading ? "Analyzing..." : "Analyze"}
              <Search className="ml-2 h-4 w-4" />
            </Button>
          </div>

          <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                <ChevronDown className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                Advanced Options
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-4 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Business Name</label>
                  <Input
                    placeholder="ABC Plumbing"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Target Location</label>
                  <Input
                    placeholder="Boston, MA"
                    value={targetLocation}
                    onChange={(e) => setTargetLocation(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Primary Service</label>
                  <Input
                    placeholder="Plumbing"
                    value={primaryService}
                    onChange={(e) => setPrimaryService(e.target.value)}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {/* Loading State */}
      {isLoading && (
        <Card className="p-12">
          <div className="flex flex-col items-center justify-center gap-4">
            <LoadingAnimation />
            <p className="text-muted-foreground">Analyzing page against 16 GEO criteria...</p>
          </div>
        </Card>
      )}

      {/* Results */}
      {result && !isLoading && (
        <div className="space-y-6">
          {/* Score Hero */}
          <Card className={`border-2 ${getGradeBgColor(result.grade)}`}>
            <CardContent className="p-8">
              <div className="flex flex-col md:flex-row items-center gap-8">
                {/* Score Circle */}
                <div className="relative">
                  <div className="w-40 h-40 rounded-full border-8 border-muted flex items-center justify-center bg-background">
                    <div className="text-center">
                      <div className="text-5xl font-bold">{result.geoScore}</div>
                      <div className="text-sm text-muted-foreground">out of 100</div>
                    </div>
                  </div>
                  <div className={`absolute -top-2 -right-2 w-12 h-12 rounded-full flex items-center justify-center text-2xl font-bold ${getGradeBgColor(result.grade)} border-2`}>
                    <span className={getGradeColor(result.grade)}>{result.grade}</span>
                  </div>
                </div>

                {/* Category Scores */}
                <div className="flex-1 space-y-4 w-full">
                  {Object.entries(result.categories).map(([key, value]) => {
                    const info = CATEGORY_INFO[key as keyof typeof CATEGORY_INFO];
                    return (
                      <div key={key} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {getCategoryIcon(key)}
                            <span className="font-medium">{info?.name || key}</span>
                          </div>
                          <span className="text-sm text-muted-foreground">
                            {value.score}/{value.max} ({value.percentage}%)
                          </span>
                        </div>
                        <Progress value={value.percentage} className="h-2" />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* URL and Stats */}
              <div className="mt-6 pt-6 border-t flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <a href={result.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 hover:text-foreground">
                  <ExternalLink className="h-4 w-4" />
                  {result.url}
                </a>
                <span>•</span>
                <span>{result.keyStats.wordCount} words</span>
                <span>•</span>
                <span>{result.keyStats.h1Count} H1</span>
                <span>•</span>
                <span>{result.keyStats.internalLinks} internal links</span>
                {result.keyStats.phoneDetected && (
                  <>
                    <span>•</span>
                    <span className="text-green-600">Phone detected</span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Detailed Results Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid grid-cols-4 w-full max-w-2xl">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="elements">16 Elements</TabsTrigger>
              <TabsTrigger value="recommendations">
                Recommendations
                {result.recommendations.critical.length > 0 && (
                  <Badge variant="destructive" className="ml-2 h-5 w-5 p-0 justify-center">
                    {result.recommendations.critical.length}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="schema">Schema</TabsTrigger>
            </TabsList>

            {/* Overview Tab */}
            <TabsContent value="overview" className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Quick Wins */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      Quick Wins
                    </CardTitle>
                    <CardDescription>Highest-impact improvements</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {result.recommendations.critical.slice(0, 3).map((rec, index) => (
                      <div key={index} className="flex items-start gap-2 p-3 bg-red-500/5 rounded-lg border border-red-500/20">
                        <AlertCircle className="h-5 w-5 text-red-500 mt-0.5 flex-shrink-0" />
                        <div>
                          <div className="font-medium text-sm">{rec.element}</div>
                          <div className="text-sm text-muted-foreground">{rec.recommendation}</div>
                        </div>
                      </div>
                    ))}
                    {result.recommendations.critical.length === 0 && (
                      <div className="flex items-center gap-2 text-green-600">
                        <CheckCircle className="h-5 w-5" />
                        <span>No critical issues found!</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Schema Status */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Code className="h-5 w-5 text-primary" />
                      Schema Status
                    </CardTitle>
                    <CardDescription>Structured data implementation</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {Object.entries(result.schemaAnalysis).map(([key, value]) => (
                      <div key={key} className="flex items-center justify-between p-2 rounded-lg bg-muted/50">
                        <span className="font-medium">{key}</span>
                        <div className="flex items-center gap-2">
                          {value.present ? (
                            value.complete ? (
                              <Badge className="bg-green-500/20 text-green-700">Complete</Badge>
                            ) : (
                              <Badge className="bg-yellow-500/20 text-yellow-700">Incomplete</Badge>
                            )
                          ) : (
                            <Badge variant="outline">Missing</Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              {/* Stats Grid */}
              <Card>
                <CardHeader>
                  <CardTitle>Page Statistics</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">{result.keyStats.wordCount}</div>
                      <div className="text-xs text-muted-foreground">Words</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">{result.keyStats.h1Count}</div>
                      <div className="text-xs text-muted-foreground">H1 Tags</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">{result.keyStats.internalLinks}</div>
                      <div className="text-xs text-muted-foreground">Internal Links</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">{result.keyStats.externalLinks}</div>
                      <div className="text-xs text-muted-foreground">External Links</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">{result.keyStats.images}</div>
                      <div className="text-xs text-muted-foreground">Images</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">{result.keyStats.imagesWithAlt}</div>
                      <div className="text-xs text-muted-foreground">With Alt</div>
                    </div>
                    <div className="text-center p-3 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">
                        {result.keyStats.phoneDetected ? (
                          <CheckCircle className="h-6 w-6 text-green-500 mx-auto" />
                        ) : (
                          <AlertCircle className="h-6 w-6 text-red-500 mx-auto" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">Phone</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Elements Tab */}
            <TabsContent value="elements" className="space-y-4">
              {Object.entries(CATEGORY_INFO).map(([categoryKey, categoryInfo]) => {
                const categoryElements = result.elements.filter(e => e.category === categoryKey);
                const categoryScore = result.categories[categoryKey as keyof typeof result.categories];
                
                return (
                  <Card key={categoryKey}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                          <categoryInfo.icon className="h-5 w-5" />
                          {categoryInfo.name}
                        </CardTitle>
                        <Badge variant="outline">
                          {categoryScore.score}/{categoryScore.max} ({categoryScore.percentage}%)
                        </Badge>
                      </div>
                      <CardDescription>{categoryInfo.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Accordion type="single" collapsible className="space-y-2">
                        {categoryElements.map((element) => (
                          <AccordionItem key={element.id} value={`element-${element.id}`} className="border rounded-lg px-4">
                            <AccordionTrigger className="hover:no-underline py-3">
                              <div className="flex items-center gap-3 w-full">
                                {getStatusIcon(element.status)}
                                <span className="font-medium flex-1 text-left">{element.name}</span>
                                <div className="flex items-center gap-2">
                                  <span className="text-sm text-muted-foreground">
                                    {element.score}/{element.maxScore}
                                  </span>
                                  {getStatusBadge(element.status)}
                                </div>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent className="space-y-4 pt-2 pb-4">
                              <div className="p-3 bg-muted/50 rounded-lg">
                                <div className="text-sm font-medium mb-1">What we found:</div>
                                <div className="text-sm text-muted-foreground">{element.finding}</div>
                              </div>
                              
                              {element.status !== "excellent" && (
                                <>
                                  <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                                    <div className="text-sm font-medium mb-1 flex items-center gap-2">
                                      <Lightbulb className="h-4 w-4 text-primary" />
                                      Recommendation:
                                    </div>
                                    <div className="text-sm">{element.recommendation}</div>
                                  </div>

                                  <div className="p-3 bg-muted/30 rounded-lg">
                                    <div className="flex items-center justify-between mb-1">
                                      <div className="text-sm font-medium">Example:</div>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        onClick={() => copyToClipboard(element.example)}
                                      >
                                        <Copy className="h-3 w-3" />
                                      </Button>
                                    </div>
                                    <div className="text-sm text-muted-foreground font-mono bg-background p-2 rounded">
                                      {element.example}
                                    </div>
                                  </div>

                                  <div className="text-sm text-muted-foreground italic">
                                    <strong>Impact:</strong> {element.impact}
                                  </div>
                                </>
                              )}
                            </AccordionContent>
                          </AccordionItem>
                        ))}
                      </Accordion>
                    </CardContent>
                  </Card>
                );
              })}
            </TabsContent>

            {/* Recommendations Tab */}
            <TabsContent value="recommendations" className="space-y-6">
              {/* Critical */}
              {result.recommendations.critical.length > 0 && (
                <Card className="border-red-500/30">
                  <CardHeader className="bg-red-500/5">
                    <CardTitle className="flex items-center gap-2 text-red-600">
                      <AlertCircle className="h-5 w-5" />
                      Critical Issues ({result.recommendations.critical.length})
                    </CardTitle>
                    <CardDescription>Fix immediately - major GEO blockers</CardDescription>
                  </CardHeader>
                  <CardContent className="divide-y">
                    {result.recommendations.critical.map((rec, index) => (
                      <div key={index} className="py-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{rec.element}</span>
                          <Badge variant="destructive">Score: {rec.currentScore}/10</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">{rec.issue}</div>
                        <div className="p-3 bg-primary/5 rounded-lg">
                          <div className="text-sm font-medium mb-1">💡 {rec.recommendation}</div>
                          <div className="text-xs text-muted-foreground mt-2 font-mono bg-background p-2 rounded">
                            {rec.example}
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground italic">
                          ⚡ {rec.impact}
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Important */}
              {result.recommendations.important.length > 0 && (
                <Card className="border-yellow-500/30">
                  <CardHeader className="bg-yellow-500/5">
                    <CardTitle className="flex items-center gap-2 text-yellow-600">
                      <AlertTriangle className="h-5 w-5" />
                      Important Improvements ({result.recommendations.important.length})
                    </CardTitle>
                    <CardDescription>Should improve - limiting AI visibility</CardDescription>
                  </CardHeader>
                  <CardContent className="divide-y">
                    {result.recommendations.important.map((rec, index) => (
                      <div key={index} className="py-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{rec.element}</span>
                          <Badge className="bg-yellow-500/20 text-yellow-700">Score: {rec.currentScore}/10</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">{rec.issue}</div>
                        <div className="p-3 bg-primary/5 rounded-lg">
                          <div className="text-sm font-medium mb-1">💡 {rec.recommendation}</div>
                          <div className="text-xs text-muted-foreground mt-2 font-mono bg-background p-2 rounded">
                            {rec.example}
                          </div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* Optimize */}
              {result.recommendations.optimize.length > 0 && (
                <Card className="border-blue-500/30">
                  <CardHeader className="bg-blue-500/5">
                    <CardTitle className="flex items-center gap-2 text-blue-600">
                      <TrendingUp className="h-5 w-5" />
                      Optimization Opportunities ({result.recommendations.optimize.length})
                    </CardTitle>
                    <CardDescription>Good but can be better</CardDescription>
                  </CardHeader>
                  <CardContent className="divide-y">
                    {result.recommendations.optimize.map((rec, index) => (
                      <div key={index} className="py-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{rec.element}</span>
                          <Badge className="bg-blue-500/20 text-blue-700">Score: {rec.currentScore}/10</Badge>
                        </div>
                        <div className="text-sm text-muted-foreground">{rec.issue}</div>
                        <div className="p-3 bg-primary/5 rounded-lg">
                          <div className="text-sm">💡 {rec.recommendation}</div>
                        </div>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {/* All Excellent */}
              {result.recommendations.critical.length === 0 && 
               result.recommendations.important.length === 0 && 
               result.recommendations.optimize.length === 0 && (
                <Card className="border-green-500/30">
                  <CardContent className="p-12 text-center">
                    <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-green-600">Perfect Score!</h3>
                    <p className="text-muted-foreground">All 16 elements are optimized for AI search visibility.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            {/* Schema Tab */}
            <TabsContent value="schema" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Code className="h-5 w-5" />
                    Schema Markup Analysis
                  </CardTitle>
                  <CardDescription>
                    Structured data helps AI understand your page - schema improves accuracy from 16% to 54%
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {Object.entries(result.schemaAnalysis).map(([key, value]) => {
                    const icons: Record<string, typeof Building2> = {
                      LocalBusiness: Building2,
                      Service: ShoppingCart,
                      FAQPage: FileText,
                      AggregateRating: Star
                    };
                    const Icon = icons[key] || Code;
                    
                    return (
                      <div key={key} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <Icon className="h-5 w-5" />
                            <span className="font-medium">{key}</span>
                          </div>
                          {value.present ? (
                            value.complete ? (
                              <Badge className="bg-green-500/20 text-green-700 border-green-500/30">
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Complete
                              </Badge>
                            ) : (
                              <Badge className="bg-yellow-500/20 text-yellow-700 border-yellow-500/30">
                                <AlertTriangle className="h-3 w-3 mr-1" />
                                Incomplete
                              </Badge>
                            )
                          ) : (
                            <Badge variant="outline" className="text-red-500 border-red-500/30">
                              <AlertCircle className="h-3 w-3 mr-1" />
                              Missing
                            </Badge>
                          )}
                        </div>
                        
                        {value.missing.length > 0 && (
                          <div className="text-sm text-muted-foreground">
                            <span className="font-medium">Missing fields: </span>
                            {value.missing.join(", ")}
                          </div>
                        )}
                        
                        {!value.present && (
                          <div className="mt-3 p-3 bg-muted/50 rounded-lg">
                            <div className="text-sm font-medium mb-2">Recommended {key} Schema:</div>
                            <pre className="text-xs bg-background p-2 rounded overflow-x-auto">
                              {key === "LocalBusiness" && `{
  "@context": "https://schema.org",
  "@type": "LocalBusiness",
  "name": "Your Business Name",
  "address": {
    "@type": "PostalAddress",
    "streetAddress": "123 Main St",
    "addressLocality": "Boston",
    "addressRegion": "MA",
    "postalCode": "02101"
  },
  "telephone": "(617) 555-1234",
  "geo": {
    "@type": "GeoCoordinates",
    "latitude": 42.3601,
    "longitude": -71.0589
  },
  "areaServed": ["Boston", "Cambridge", "Somerville"],
  "openingHours": "Mo-Fr 08:00-18:00"
}`}
                              {key === "Service" && `{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "Plumbing Services",
  "provider": {
    "@type": "LocalBusiness",
    "name": "Your Business"
  },
  "areaServed": "Boston, MA",
  "offers": {
    "@type": "Offer",
    "priceSpecification": {
      "@type": "PriceSpecification",
      "price": "99",
      "priceCurrency": "USD",
      "unitText": "per hour"
    }
  }
}`}
                              {key === "FAQPage" && `{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "How much does a plumber cost in Boston?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Boston plumbers typically charge $75-$150 per hour..."
      }
    }
  ]
}`}
                              {key === "AggregateRating" && `{
  "@type": "AggregateRating",
  "ratingValue": "4.9",
  "reviewCount": "127",
  "bestRating": "5"
}`}
                            </pre>
                            <Button
                              variant="outline"
                              size="sm"
                              className="mt-2"
                              onClick={() => copyToClipboard(key === "LocalBusiness" ? `{"@context":"https://schema.org","@type":"LocalBusiness","name":"Your Business Name","address":{"@type":"PostalAddress","streetAddress":"123 Main St","addressLocality":"Boston","addressRegion":"MA","postalCode":"02101"},"telephone":"(617) 555-1234","geo":{"@type":"GeoCoordinates","latitude":42.3601,"longitude":-71.0589},"areaServed":["Boston","Cambridge","Somerville"],"openingHours":"Mo-Fr 08:00-18:00"}` : "Schema template")}
                            >
                              <Copy className="h-3 w-3 mr-1" />
                              Copy Template
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
}

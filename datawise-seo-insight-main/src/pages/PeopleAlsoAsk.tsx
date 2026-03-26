import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { Loader2, Search, HelpCircle, ExternalLink, Download, GitBranch, LayoutGrid, ChevronRight, ChevronDown, Target, Lightbulb } from "lucide-react";
import { fetchPeopleAlsoAsk } from "@/lib/dataforseo";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";

interface PAAItem {
  position: number;
  source_type: string;
  question: string;
  answer: string;
  source_url?: string;
  source_domain?: string;
  search_iteration?: number;
  depth_level?: number;
  parent_keyword?: string;
}

interface ContentMapCluster {
  theme: string;
  questions: Array<{
    question: string;
    answer: string;
    source_url: string;
    depth_level: number;
  }>;
  count: number;
}

interface TreeNode {
  question?: string;
  keyword?: string;
  answer?: string;
  source_url?: string;
  source_domain?: string;
  depth_level?: number;
  children: TreeNode[];
}

interface ContentMap {
  tree: TreeNode;
  clusters: ContentMapCluster[];
  related_searches: string[];
  total_questions: number;
  total_related: number;
  depth_reached: number;
}

function TreeBranch({ node, depth = 0 }: { node: TreeNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const hasChildren = node.children && node.children.length > 0;
  const label = node.question || node.keyword || '';

  return (
    <div className={depth > 0 ? "ml-6 border-l-2 border-muted pl-4" : ""}>
      <div
        className={`flex items-start gap-2 py-2 ${hasChildren ? 'cursor-pointer' : ''} ${depth === 0 ? '' : 'hover:bg-muted/30 rounded px-2 -mx-2'}`}
        onClick={() => hasChildren && setExpanded(!expanded)}
      >
        {hasChildren ? (
          expanded ? <ChevronDown className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-0.5 flex-shrink-0 text-muted-foreground" />
        ) : (
          <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
            <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          {depth === 0 ? (
            <div className="flex items-center gap-2">
              <Target className="h-5 w-5 text-primary" />
              <span className="font-semibold text-lg">{label}</span>
              {hasChildren && (
                <Badge variant="secondary" className="text-xs">{node.children.length} branches</Badge>
              )}
            </div>
          ) : (
            <div>
              <span className="text-sm">{label}</span>
              {hasChildren && (
                <Badge variant="outline" className="text-xs ml-2">{node.children.length}</Badge>
              )}
              {node.source_domain && (
                <span className="text-xs text-muted-foreground ml-2">{node.source_domain}</span>
              )}
            </div>
          )}
        </div>
      </div>
      {expanded && hasChildren && (
        <div className="mt-1">
          {node.children.map((child, i) => (
            <TreeBranch key={i} node={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

const PeopleAlsoAsk = () => {
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("2840");
  const [language, setLanguage] = useState("en");
  const [depth, setDepth] = useState("2");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<PAAItem[]>([]);
  const [sourceStats, setSourceStats] = useState<Record<string, number>>({});
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [extractionMethod, setExtractionMethod] = useState<string>('');
  const [clicksSimulated, setClicksSimulated] = useState<number>(0);
  const [estimatedCost, setEstimatedCost] = useState<number>(0);
  const [apiCallsMade, setApiCallsMade] = useState<number>(0);
  const [keywordsSearched, setKeywordsSearched] = useState<string[]>([]);
  const [iterationStats, setIterationStats] = useState<Record<string, number>>({});
  const [contentMap, setContentMap] = useState<ContentMap | null>(null);

  const handleDownloadCSV = () => {
    if (data.length === 0) {
      toast({ title: "No data", description: "No questions available to download", variant: "destructive" });
      return;
    }

    const csvData = data.map(item => ({
      Position: item.position,
      Question: item.question,
      Answer: item.answer,
      Source_Type: item.source_type,
      Source_URL: item.source_url,
      Source_Domain: item.source_domain,
      Search_Iteration: item.search_iteration || 1,
      Depth_Level: item.depth_level || 1,
      Parent_Keyword: item.parent_keyword || keyword
    }));

    const headers = Object.keys(csvData[0]);
    const csvContent = [
      headers.join(','),
      ...csvData.map(row =>
        headers.map(header => {
          const value = (row as any)[header] || '';
          if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
            return `"${value.replace(/"/g, '""')}"`;
          }
          return value;
        }).join(',')
      )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', `paa_content_map_${keyword}_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({ title: "CSV Downloaded", description: `${data.length} questions exported successfully` });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyword.trim()) {
      toast({ title: "Error", description: "Please enter a keyword", variant: "destructive" });
      return;
    }

    setLoading(true);
    try {
      const result: any = await fetchPeopleAlsoAsk({
        keyword: keyword.trim(),
        location,
        language,
        depth: parseInt(depth),
      });

      setData(result?.data || []);
      setSourceStats(result?.source_stats || {});
      setExtractionMethod(result?.extraction_method || '');
      setClicksSimulated(result?.clicks_simulated || 0);
      setEstimatedCost(result?.estimated_cost || 0);
      setApiCallsMade(result?.api_calls_made || 1);
      setKeywordsSearched(result?.keywords_searched || []);
      setIterationStats(result?.iteration_stats || {});
      setContentMap(result?.content_map || null);

      toast({
        title: "Success",
        description: `Found ${result?.data?.length || 0} items across ${result?.api_calls_made || 1} searches at ${result?.clicks_simulated || 1} depth levels`,
      });
    } catch (error: any) {
      console.error('Error fetching People Also Ask data:', error);
      toast({ title: "Error", description: error.message || "Failed to fetch People Also Ask data", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const filteredData = selectedSource === 'all'
    ? data
    : data.filter(item => item.source_type === selectedSource);

  const getSourceTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'people_also_ask': 'People Also Ask',
      'answer_box': 'Answer Box',
      'featured_snippet': 'Featured Snippet',
      'related_search': 'Related Search',
      'knowledge_graph': 'Knowledge Graph'
    };
    return labels[type] || type;
  };

  const getSourceTypeBadgeVariant = (type: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      'people_also_ask': 'default',
      'answer_box': 'secondary',
      'featured_snippet': 'outline',
      'related_search': 'secondary',
      'knowledge_graph': 'default'
    };
    return variants[type] || 'outline';
  };

  const getDepthBadgeColor = (level: number) => {
    if (level === 1) return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
    if (level === 2) return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
  };

  return (
    <div className="container mx-auto py-8">
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">People Also Ask + Content Map</h1>
          <p className="text-muted-foreground mt-2">
            Deep-search PAA questions across multiple levels to build a content strategy map for ranking on any topic.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HelpCircle className="h-5 w-5" />
              Search Parameters
            </CardTitle>
            <CardDescription>
              Set your keyword, location, and search depth. Higher depth discovers more questions but uses more API calls.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="keyword">Keyword</Label>
                  <Input
                    id="keyword"
                    type="text"
                    placeholder="Enter keyword..."
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="location">Location</Label>
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
                  <Label htmlFor="language">Language</Label>
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

                <div className="space-y-2">
                  <Label htmlFor="depth">Search Depth</Label>
                  <Select value={depth} onValueChange={setDepth}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Quick (1 level)</SelectItem>
                      <SelectItem value="2">Standard (2 levels)</SelectItem>
                      <SelectItem value="3">Deep (3 levels)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <Button type="submit" disabled={loading} className="w-full md:w-auto">
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Searching depth {depth}...
                    </>
                  ) : (
                    <>
                      <Search className="mr-2 h-4 w-4" />
                      Search & Build Content Map
                    </>
                  )}
                </Button>
                {parseInt(depth) >= 2 && (
                  <p className="text-xs text-muted-foreground">
                    Depth {depth} uses up to {depth === "2" ? "~6" : "~18"} API calls per search
                  </p>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        {data.length > 0 && (
          <div className="space-y-6">
            {/* Stats Bar */}
            {extractionMethod && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground font-medium">Total Questions</p>
                  <p className="text-2xl font-bold">{data.filter(d => d.source_type === 'people_also_ask').length}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground font-medium">Related Searches</p>
                  <p className="text-2xl font-bold">{data.filter(d => d.source_type === 'related_search').length}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground font-medium">API Calls</p>
                  <p className="text-2xl font-bold">{apiCallsMade}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground font-medium">Depth Reached</p>
                  <p className="text-2xl font-bold">{clicksSimulated} levels</p>
                </Card>
                <Card className="p-4">
                  <p className="text-xs text-muted-foreground font-medium">Est. Cost</p>
                  <p className="text-2xl font-bold">${estimatedCost?.toFixed(4) || '0.0000'}</p>
                </Card>
              </div>
            )}

            {/* Depth breakdown */}
            {Object.keys(iterationStats).length > 1 && (
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-muted-foreground">By depth:</span>
                {Object.entries(iterationStats).sort().map(([key, count]) => (
                  <Badge key={key} variant="outline" className={getDepthBadgeColor(parseInt(key.split('_')[1]))}>
                    Level {key.split('_')[1]}: {count} items
                  </Badge>
                ))}
              </div>
            )}

            {/* Main content tabs: Questions vs Content Map */}
            <Tabs defaultValue="questions" className="w-full">
              <TabsList>
                <TabsTrigger value="questions" className="flex items-center gap-2">
                  <HelpCircle className="h-4 w-4" />
                  All Questions
                </TabsTrigger>
                <TabsTrigger value="content-map" className="flex items-center gap-2">
                  <GitBranch className="h-4 w-4" />
                  Content Map
                </TabsTrigger>
                <TabsTrigger value="clusters" className="flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4" />
                  Topic Clusters
                </TabsTrigger>
              </TabsList>

              {/* Content Map Tree */}
              <TabsContent value="content-map" className="mt-6">
                {contentMap?.tree ? (
                  <Card>
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="flex items-center gap-2">
                            <GitBranch className="h-5 w-5" />
                            Content Map for "{keyword}"
                          </CardTitle>
                          <CardDescription>
                            Hierarchical map of questions branching from your keyword. Each branch is a content opportunity.
                          </CardDescription>
                        </div>
                        <Button onClick={handleDownloadCSV} variant="outline" size="sm" className="flex items-center gap-2">
                          <Download className="h-4 w-4" />
                          Export CSV
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent>
                      <div className="p-4 bg-muted/30 rounded-lg border mb-6">
                        <div className="flex items-start gap-3">
                          <Lightbulb className="h-5 w-5 text-yellow-500 mt-0.5 flex-shrink-0" />
                          <div className="text-sm">
                            <p className="font-medium mb-1">How to use this content map</p>
                            <p className="text-muted-foreground">
                              The root keyword is your pillar page. Each Level 1 branch is a supporting article or FAQ section.
                              Level 2+ questions show what sub-topics each article should cover.
                              Expand branches to see the full topic tree, then use "Topic Clusters" to see them grouped by theme.
                            </p>
                          </div>
                        </div>
                      </div>
                      <TreeBranch node={contentMap.tree} />

                      {contentMap.related_searches.length > 0 && (
                        <div className="mt-8 pt-6 border-t">
                          <h3 className="text-sm font-semibold mb-3 text-muted-foreground">Related Searches (additional content angles)</h3>
                          <div className="flex flex-wrap gap-2">
                            {contentMap.related_searches.map((search, i) => (
                              <Badge key={i} variant="outline" className="text-xs py-1">
                                {search}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <p className="text-muted-foreground text-center py-12">No tree data available. Try increasing search depth.</p>
                )}
              </TabsContent>

              {/* Topic Clusters */}
              <TabsContent value="clusters" className="mt-6">
                {contentMap?.clusters && contentMap.clusters.length > 0 ? (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h2 className="text-lg font-semibold">Topic Clusters</h2>
                        <p className="text-sm text-muted-foreground">
                          Questions grouped by shared themes. Each cluster is a potential content pillar or article.
                        </p>
                      </div>
                      <Button onClick={handleDownloadCSV} variant="outline" size="sm" className="flex items-center gap-2">
                        <Download className="h-4 w-4" />
                        Export CSV
                      </Button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {contentMap.clusters.map((cluster, idx) => (
                        <Card key={idx} className="overflow-hidden">
                          <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                              <CardTitle className="text-base flex items-center gap-2">
                                <Target className="h-4 w-4 text-primary" />
                                {cluster.theme}
                              </CardTitle>
                              <Badge variant="secondary">{cluster.count} questions</Badge>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <ul className="space-y-2">
                              {cluster.questions.map((q, qIdx) => (
                                <li key={qIdx} className="flex items-start gap-2 text-sm">
                                  <Badge variant="outline" className={`text-[10px] px-1.5 flex-shrink-0 mt-0.5 ${getDepthBadgeColor(q.depth_level)}`}>
                                    L{q.depth_level}
                                  </Badge>
                                  <span>{q.question}</span>
                                </li>
                              ))}
                            </ul>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-center py-12">No clusters available. Try increasing search depth to 2+.</p>
                )}
              </TabsContent>

              {/* All Questions flat list */}
              <TabsContent value="questions" className="mt-6">
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle>
                          All Questions & Answers
                          <span className="text-sm font-normal text-muted-foreground ml-2">
                            ({filteredData.length} items)
                          </span>
                        </CardTitle>
                        <CardDescription>
                          Full list of discovered questions across all depth levels
                        </CardDescription>
                      </div>
                      <Button onClick={handleDownloadCSV} variant="outline" size="sm" className="flex items-center gap-2">
                        <Download className="h-4 w-4" />
                        Download CSV
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center gap-4 mb-6">
                      <label className="text-sm font-medium">Filter by source:</label>
                      <Select value={selectedSource} onValueChange={setSelectedSource}>
                        <SelectTrigger className="w-[200px]">
                          <SelectValue placeholder="Select source type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Sources ({data.length})</SelectItem>
                          {Object.entries(sourceStats).map(([source, count]) => (
                            <SelectItem key={source} value={source}>
                              {getSourceTypeLabel(source)} ({count})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      {filteredData.map((item, index) => (
                        <div key={index} className="flex items-start gap-3 p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                          <div className="flex flex-col gap-1 flex-shrink-0">
                            <Badge variant={getSourceTypeBadgeVariant(item.source_type)} className="text-xs">
                              {getSourceTypeLabel(item.source_type)}
                            </Badge>
                            {(item.depth_level || 1) > 1 && (
                              <Badge variant="outline" className={`text-[10px] ${getDepthBadgeColor(item.depth_level || 1)}`}>
                                Depth {item.depth_level}
                              </Badge>
                            )}
                          </div>
                          <div className="flex-1">
                            <p className="text-sm">{item.question}</p>
                            {item.answer && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.answer}</p>
                            )}
                            {item.source_url && item.source_type !== 'related_search' && (
                              <a
                                href={item.source_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-blue-600 mt-1"
                              >
                                {item.source_domain || 'View source'}
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        )}
      </div>
    </div>
  );
};

export default PeopleAlsoAsk;

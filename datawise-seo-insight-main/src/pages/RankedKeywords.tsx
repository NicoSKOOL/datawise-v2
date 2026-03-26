import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp } from "lucide-react";
import { fetchRankedKeywords } from "@/lib/dataforseo";
import { useToast } from "@/components/ui/use-toast";
import { DataTable } from "@/components/DataTable";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";

export default function RankedKeywords() {
  const [domain, setDomain] = useState("");
  const [location, setLocation] = useState("2840");
  const [language, setLanguage] = useState("en");
  const [limit, setLimit] = useState("100");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const [totalAvailable, setTotalAvailable] = useState<number>(0);
  const { toast } = useToast();

  const limitOptions = [
    { value: "10", label: "10 keywords" },
    { value: "25", label: "25 keywords" },
    { value: "50", label: "50 keywords" },
    { value: "100", label: "100 keywords" },
    { value: "250", label: "250 keywords" },
    { value: "500", label: "500 keywords" },
    { value: "1000", label: "All keywords" }
  ];

  const handleAnalyze = async () => {
    if (!domain.trim()) return;
    
    setLoading(true);
    setResults([]);
    setMetrics(null);
    setTotalAvailable(0);
    
    try {
      const data: any = await fetchRankedKeywords({
        target: domain.trim(),
        location_code: parseInt(location),
        language_code: language,
        limit: parseInt(limit)
      });

      if (data?.tasks?.[0]?.result?.[0]?.items) {
        const result = data.tasks[0].result[0];
        const items = result.items || [];
        const totalCount = result.total_count || 0;
        
        const cleanedResults = items.map((item: any) => ({
          keyword: item.keyword_data?.keyword || '',
          position: item.ranked_serp_element?.serp_item?.rank_group || 0,
          search_volume: item.keyword_data?.keyword_info?.search_volume || 0,
          cpc: item.keyword_data?.keyword_info?.cpc || 0,
          competition: item.keyword_data?.keyword_info?.competition || 0,
          url: item.ranked_serp_element?.serp_item?.url || '',
          title: item.ranked_serp_element?.serp_item?.title || ''
        }));
        
        setResults(cleanedResults);
        setTotalAvailable(totalCount);
        setMetrics({
          total_keywords: cleanedResults.length,
          total_available: totalCount,
          avg_position: cleanedResults.reduce((sum: number, item: any) => sum + item.position, 0) / cleanedResults.length,
          total_search_volume: cleanedResults.reduce((sum: number, item: any) => sum + item.search_volume, 0)
        });
        
        toast({
          title: "Success",
          description: `Found ${cleanedResults.length} of ${totalCount} ranked keywords`,
        });
      } else {
        toast({
          title: "No results",
          description: "No ranked keywords found for this domain",
        });
      }
    } catch (error: any) {
      console.error('Error fetching ranked keywords:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch ranked keywords",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Ranked Keywords</h1>
        <p className="text-muted-foreground">
          Discover what keywords a domain ranks for in Google search results.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Domain Keyword Analysis
          </CardTitle>
          <CardDescription>
            Enter a domain to see which keywords it ranks for and their positions
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="domain">Target Domain</Label>
            <Input
              id="domain"
              placeholder="e.g., example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAnalyze()}
              className="w-full"
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="location">Location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger id="location">
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent className="bg-popover border z-50">
                  {locationOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value.toString()}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="language">Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="language">
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent className="bg-popover border z-50">
                  {languageOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="limit">Results Limit</Label>
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger id="limit">
                  <SelectValue placeholder="Select limit" />
                </SelectTrigger>
                <SelectContent className="bg-popover border z-50">
                  {limitOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="flex justify-start">
            <Button 
              onClick={handleAnalyze} 
              disabled={loading || !domain.trim()}
              className="w-full md:w-auto"
            >
              {loading ? "Analyzing..." : "Find Keywords"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Showing Keywords</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.total_keywords?.toLocaleString() || "--"}
              </div>
              <p className="text-xs text-muted-foreground">currently displayed</p>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => totalAvailable > results.length && setLimit("1000")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center justify-between">
                Total Available
                {totalAvailable > results.length && (
                  <span className="text-xs text-primary">Click to load all</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-primary">
                {totalAvailable?.toLocaleString() || "--"}
              </div>
              <p className="text-xs text-muted-foreground">
                {totalAvailable > results.length ? "available keywords" : "all loaded"}
              </p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Average Position</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.avg_position ? Math.round(metrics.avg_position) : "--"}
              </div>
              <p className="text-xs text-muted-foreground">average rank</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Search Volume</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.total_search_volume?.toLocaleString() || "--"}
              </div>
              <p className="text-xs text-muted-foreground">monthly searches</p>
            </CardContent>
          </Card>
        </div>
      )}

      <DataTable 
        data={results}
        title="Ranked Keywords"
        description="Keywords this domain ranks for in search results"
        loading={loading}
      />
    </div>
  );
}
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { DataTable } from "@/components/DataTable";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";
import { fetchKeywordOverview } from "@/lib/dataforseo";

export default function KeywordOverview() {
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("2840");
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const { toast } = useToast();

  const handleAnalyze = async () => {
    if (!keyword.trim()) return;
    
    setLoading(true);
    setResults([]);
    setMetrics(null);
    
    try {
      const data: any = await fetchKeywordOverview({
        keyword: keyword.trim(),
        location_code: parseInt(location),
        language_code: language
      });

      if (data?.tasks?.[0]?.result?.[0]?.items?.[0]) {
        const result = data.tasks[0].result[0];
        const item = result.items[0];

        // Extract individual keyword data from items
        const cleanedResult = {
          se_type: item.se_type || 'google',
          keyword: item.keyword || keyword.trim(),
          search_volume: item.keyword_info?.search_volume || 0,
          cpc: item.keyword_info?.cpc || 0,
          competition: item.keyword_info?.competition || 0,
          keyword_difficulty: item.keyword_properties?.keyword_difficulty || 0
        };

        setResults([cleanedResult]);
        setMetrics(cleanedResult);
        toast({
          title: "Success",
          description: "Keyword analysis completed successfully",
        });
      } else {
        toast({
          title: "No results",
          description: "No overview data found for this keyword",
        });
      }
    } catch (error: any) {
      console.error('Error fetching keyword overview:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch keyword overview",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Keyword Overview</h1>
        <p className="text-muted-foreground">
          Get a comprehensive analysis of keyword metrics, trends, and SERP data.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Complete Keyword Analysis
          </CardTitle>
          <CardDescription>
            Enter a keyword to get detailed metrics including search volume, CPC, competition, and trends
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="keyword">Target Keyword</Label>
            <Input
              id="keyword"
              placeholder="e.g., online marketing"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleAnalyze()}
              className="w-full"
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="location">Location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger id="location">
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
            
            <div>
              <Label htmlFor="language">Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="language">
                  <SelectValue placeholder="Select language" />
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
          
          <div className="flex justify-start">
            <Button 
              onClick={handleAnalyze} 
              disabled={loading || !keyword.trim()}
              className="w-full md:w-auto"
            >
              {loading ? "Analyzing..." : "Get Overview"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Search Volume</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? "--" : (metrics?.search_volume?.toLocaleString() || "--")}
            </div>
            <p className="text-xs text-muted-foreground">monthly searches</p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Keyword Difficulty</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? "--" : (metrics?.keyword_difficulty || "--")}
            </div>
            <p className="text-xs text-muted-foreground">out of 100</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">CPC</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? "$--" : `$${metrics?.cpc || "--"}`}
            </div>
            <p className="text-xs text-muted-foreground">cost per click</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Competition</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? "--" : (metrics?.competition || "--")}
            </div>
            <p className="text-xs text-muted-foreground">competition level</p>
          </CardContent>
        </Card>
      </div>

      <DataTable 
        data={results}
        title="Detailed Keyword Analysis"
        description="Complete keyword metrics, trends, and SERP analysis"
        loading={loading}
      />

    </div>
  );
}
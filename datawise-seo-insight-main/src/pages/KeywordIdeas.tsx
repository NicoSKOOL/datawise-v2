import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Target } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { DataTable } from "@/components/DataTable";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";
import { fetchKeywordIdeas } from "@/lib/dataforseo";

export default function KeywordIdeas() {
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("2840");
  const [language, setLanguage] = useState("en");
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const { toast } = useToast();

  const limitOptions = [
    { value: 25, label: "25 keywords" },
    { value: 50, label: "50 keywords" },
    { value: 100, label: "100 keywords" }
  ];

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    
    setLoading(true);
    setResults([]);
    
    try {
      const data: any = await fetchKeywordIdeas({
        keyword: keyword.trim(),
        location_code: parseInt(location),
        language_code: language
      });

      if (data?.tasks?.[0]?.result?.[0]?.items) {
        const cleanedResults = data.tasks[0].result[0].items
          .slice(0, limit)
          .map((item: any) => ({
            se_type: item.se_type,
            keyword: item.keyword,
            cpc: item.keyword_info?.cpc || 0,
            search_volume: item.keyword_info?.search_volume || 0,
            competition: item.keyword_info?.competition || 0
          }));

        setResults(cleanedResults);
        toast({
          title: "Success",
          description: `Found ${cleanedResults.length} keyword ideas`,
        });
      } else {
        toast({
          title: "No results",
          description: "No keyword ideas found for this term",
        });
      }
    } catch (error: any) {
      console.error('Error fetching keyword ideas:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch keyword ideas",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Keyword Ideas</h1>
        <p className="text-muted-foreground">
          Discover fresh keyword ideas and opportunities for your content strategy.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5" />
            Discover Ideas
          </CardTitle>
          <CardDescription>
            Enter a topic or keyword to discover new content opportunities
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="keyword">Seed Keyword</Label>
            <Input
              id="keyword"
              placeholder="e.g., seo tools"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
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
            
            <div>
              <Label htmlFor="limit">Results Limit</Label>
              <Select value={limit.toString()} onValueChange={(value) => setLimit(parseInt(value))}>
                <SelectTrigger id="limit">
                  <SelectValue placeholder="Select limit" />
                </SelectTrigger>
                <SelectContent>
                  {limitOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value.toString()}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="flex justify-start">
            <Button 
              onClick={handleSearch} 
              disabled={loading || !keyword.trim()}
              className="w-full md:w-auto"
            >
              {loading ? "Generating..." : "Generate"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <DataTable 
        data={results}
        title="Keyword Ideas"
        description="Fresh keyword ideas and opportunities for your content"
        loading={loading}
      />

    </div>
  );
}
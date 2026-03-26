import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lightbulb } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { DataTable } from "@/components/DataTable";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";
import { fetchKeywordSuggestions } from "@/lib/dataforseo";

export default function KeywordSuggestions() {
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("2840"); // Default to US
  const [language, setLanguage] = useState("en"); // Default to English
  const [limit, setLimit] = useState("100"); // Default to 100 results
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const { toast } = useToast();

  // Limit options
  const limitOptions = [
    { value: "10", label: "10 keywords" },
    { value: "25", label: "25 keywords" },
    { value: "50", label: "50 keywords" },
    { value: "100", label: "100 keywords" },
    { value: "200", label: "200 keywords" },
    { value: "500", label: "500 keywords" },
  ];

  const handleSearch = async () => {
    if (!keyword.trim()) return;
    
    setLoading(true);
    setResults([]);
    
    try {
      const data: any = await fetchKeywordSuggestions({
        keyword: keyword.trim(),
        location_code: parseInt(location),
        language_code: language,
        limit: parseInt(limit)
      });

      console.log('Frontend received data:', data);

      if (data?.tasks?.[0]?.result?.[0]?.items) {
        // Extract only the specific fields needed
        const cleanedResults = data.tasks[0].result[0].items.map((item: any) => ({
          se_type: item.se_type,
          keyword: item.keyword,
          cpc: item.keyword_info?.cpc || 0,
          search_volume: item.keyword_info?.search_volume || 0,
          competition: item.keyword_info?.competition || 0
        }));

        setResults(cleanedResults);
        toast({
          title: "Success",
          description: `Found ${cleanedResults.length} keyword suggestions`,
        });
      } else {
        console.log('No results found. Data structure:', JSON.stringify(data, null, 2));
        toast({
          title: "No results",
          description: "No keyword suggestions found for this term",
        });
      }
    } catch (error: any) {
      console.error('Error fetching keyword suggestions:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch keyword suggestions",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Keyword Suggestions</h1>
        <p className="text-muted-foreground">
          Get intelligent keyword suggestions based on your seed keyword using DataForSEO's algorithm.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5" />
            Generate Suggestions
          </CardTitle>
          <CardDescription>
            Enter a seed keyword to receive intelligent suggestions
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="location">Location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger>
                  <SelectValue placeholder="Select location" />
                </SelectTrigger>
                <SelectContent>
                  {locationOptions.map((loc) => (
                    <SelectItem key={loc.value} value={loc.value.toString()}>
                      {loc.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="language">Language</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  {languageOptions.map((lang) => (
                    <SelectItem key={lang.value} value={lang.value}>
                      {lang.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="limit">Results Limit</Label>
              <Select value={limit} onValueChange={setLimit}>
                <SelectTrigger>
                  <SelectValue placeholder="Select limit" />
                </SelectTrigger>
                <SelectContent>
                  {limitOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button 
                onClick={handleSearch} 
                disabled={loading || !keyword.trim()}
                className="w-full"
              >
                {loading ? "Generating..." : "Generate"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <DataTable 
        data={results}
        title="Keyword Suggestions"
        description="AI-powered keyword suggestions based on your seed keyword"
        loading={loading}
      />

    </div>
  );
}
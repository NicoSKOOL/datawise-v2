import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { DataTable } from "@/components/DataTable";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";
import { fetchRelatedKeywords } from "@/lib/dataforseo";

export default function RelatedKeywords() {
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("2840"); // Default to US
  const [language, setLanguage] = useState("en"); // Default to English
  const [limit, setLimit] = useState("50"); // Default to 50 results
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
      const data: any = await fetchRelatedKeywords({
        keyword: keyword.trim(),
        location_code: parseInt(location),
        language_code: language,
        limit: parseInt(limit)
      });

      console.log('Frontend received data:', data);

      // Extract related keywords from the nested structure
      const taskResult = data?.tasks?.[0]?.result?.[0];
      if (taskResult && taskResult.items && taskResult.items.length > 0) {
        // Each item in the items array represents a keyword with full metrics
        const transformedResults = taskResult.items.map((item: any) => {
          const keywordData = item.keyword_data || {};
          const keywordInfo = keywordData.keyword_info || {};

          return {
            keyword: keywordData.keyword || '-',
            search_volume: keywordInfo.search_volume || 0,
            competition: keywordInfo.competition || 0,
            cpc: keywordInfo.cpc || 0,
            competition_level: keywordInfo.competition_level || '-'
          };
        });

        console.log(`Transformed ${transformedResults.length} related keywords:`, transformedResults);

        setResults(transformedResults);

        toast({
          title: "Success",
          description: `Found ${transformedResults.length} related keywords`,
        });
      } else {
        console.log('No results found. Data structure:', JSON.stringify(data, null, 2));
        toast({
          title: "No results",
          description: "No related keywords found for this term",
        });
      }
    } catch (error: any) {
      console.error('Error fetching related keywords:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch related keywords",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Related Keywords</h1>
        <p className="text-muted-foreground">
          Find keywords related to your main terms using DataForSEO's comprehensive database. Customize location, language, and result limits for better targeting.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Keyword Research
          </CardTitle>
          <CardDescription>
            Enter a keyword and customize location, language, and result limits to find related terms
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="keyword">Target Keyword</Label>
            <Input
              id="keyword"
              placeholder="e.g., digital marketing"
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
                {loading ? "Searching..." : "Search"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <DataTable 
        data={results}
        title="Related Keywords"
        description="Keywords related to your target term"
        loading={loading}
      />

    </div>
  );
}
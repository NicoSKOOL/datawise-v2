import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Users } from "lucide-react";
import { fetchCompetitorsDomain } from "@/lib/dataforseo";
import { useToast } from "@/components/ui/use-toast";
import { DataTable } from "@/components/DataTable";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";

export default function CompetitorsDomain() {
  const [domain, setDomain] = useState("");
  const [location, setLocation] = useState("2840");
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const { toast } = useToast();

  const handleAnalyze = async () => {
    if (!domain.trim()) return;
    
    setLoading(true);
    setResults([]);
    setMetrics(null);
    
    try {
      const data: any = await fetchCompetitorsDomain({
        target: domain.trim(),
        location_code: parseInt(location),
        language_code: language
      });

      if (data?.tasks?.[0]?.result?.[0]?.items) {
        const result = data.tasks[0].result[0];
        const items = result.items || [];
        
        const cleanedResults = items.map((item: any) => {
          const organicMetrics = item.full_domain_metrics?.organic || {};
          
          // Calculate position groupings
          const pos_1 = organicMetrics.pos_1 || 0;
          const pos_2_3 = organicMetrics.pos_2_3 || 0;
          const pos_4_20 = (organicMetrics.pos_4_10 || 0) + (organicMetrics.pos_11_20 || 0);
          const pos_21_100 = (organicMetrics.pos_21_30 || 0) + 
                             (organicMetrics.pos_31_40 || 0) + 
                             (organicMetrics.pos_41_50 || 0) + 
                             (organicMetrics.pos_51_60 || 0) + 
                             (organicMetrics.pos_61_70 || 0) + 
                             (organicMetrics.pos_71_80 || 0) + 
                             (organicMetrics.pos_81_90 || 0) + 
                             (organicMetrics.pos_91_100 || 0);
          
          return {
            domain: item.domain || '',
            avg_position: Math.round(item.avg_position || 0),
            intersections: item.intersections || 0,
            pos_1: pos_1,
            pos_2_3: pos_2_3,
            pos_4_20: pos_4_20,
            pos_21_100: pos_21_100,
            organic_etv: Math.round(organicMetrics.etv || 0),
            total_keywords: organicMetrics.count || 0
          };
        });
        
        setResults(cleanedResults);
        setMetrics({
          total_competitors: cleanedResults.length,
          avg_intersections: cleanedResults.length > 0 ? 
            Math.round(cleanedResults.reduce((sum: number, item: any) => sum + item.intersections, 0) / cleanedResults.length) : 0,
          top_competitor: cleanedResults.length > 0 ? cleanedResults[0].domain : null,
          total_organic_traffic: cleanedResults.reduce((sum: number, item: any) => sum + item.organic_etv, 0)
        });
        
        toast({
          title: "Success",
          description: `Found ${cleanedResults.length} competitor domains`,
        });
      } else {
        toast({
          title: "No results",
          description: "No competitor domains found",
        });
      }
    } catch (error: any) {
      console.error('Error fetching competitors domain:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch competitor domains",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Competitors Domain</h1>
        <p className="text-muted-foreground">
          Find competitor domains based on shared ranking keywords.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Competitor Discovery
          </CardTitle>
          <CardDescription>
            Enter a domain to find its competitors based on shared keyword rankings
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
              disabled={loading || !domain.trim()}
              className="w-full md:w-auto"
            >
              {loading ? "Analyzing..." : "Find Competitors"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Competitors</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.total_competitors?.toLocaleString() || "--"}
              </div>
              <p className="text-xs text-muted-foreground">domains found</p>
            </CardContent>
          </Card>
          
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Avg Intersections</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.avg_intersections?.toLocaleString() || "--"}
              </div>
              <p className="text-xs text-muted-foreground">shared keywords</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Total Traffic</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.total_organic_traffic?.toLocaleString() || "--"}
              </div>
              <p className="text-xs text-muted-foreground">estimated monthly</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Top Competitor</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm font-bold truncate">
                {metrics.top_competitor || "--"}
              </div>
              <p className="text-xs text-muted-foreground">closest competitor</p>
            </CardContent>
          </Card>
        </div>
      )}

      <DataTable 
        data={results}
        title="Competitor Domains"
        description="Domains that compete for similar keywords"
        loading={loading}
      />
    </div>
  );
}
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Zap } from "lucide-react";
import { fetchBulkTrafficEstimation } from "@/lib/dataforseo";
import { useToast } from "@/components/ui/use-toast";
import { DataTable } from "@/components/DataTable";
import { locationOptions, languageOptions } from "@/lib/dataForSeoLocations";

export default function BulkTrafficEstimation() {
  const [targets, setTargets] = useState("");
  const [location, setLocation] = useState("2840");
  const [language, setLanguage] = useState("en");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<any>(null);
  const { toast } = useToast();

  const handleAnalyze = async () => {
    if (!targets.trim()) return;
    
    setLoading(true);
    setResults([]);
    setMetrics(null);
    
    try {
      // Parse targets from textarea (one per line)
      const targetList = targets
        .split('\n')
        .map(t => t.trim())
        .filter(t => t.length > 0);

      if (targetList.length === 0) {
        toast({
          title: "Error",
          description: "Please enter at least one domain or URL",
          variant: "destructive"
        });
        return;
      }
      
      const data: any = await fetchBulkTrafficEstimation({
        targets: targetList,
        location_code: parseInt(location),
        language_code: language
      });

      if (data?.tasks?.[0]?.result?.[0]?.items) {
        const result = data.tasks[0].result[0];
        const items = result.items || [];
        
        const cleanedResults = items.map((item: any) => ({
          target: item.target || '',
          organic_etv: Math.round(item.metrics?.organic?.etv || 0),
          organic_count: item.metrics?.organic?.count || 0,
          paid_etv: Math.round(item.metrics?.paid?.etv || 0),
          paid_count: item.metrics?.paid?.count || 0,
          total_count: (item.metrics?.organic?.count || 0) + (item.metrics?.paid?.count || 0)
        }));
        
        setResults(cleanedResults);
        setMetrics({
          total_domains: cleanedResults.length,
          total_organic_traffic: cleanedResults.reduce((sum: number, item: any) => sum + item.organic_etv, 0),
          total_keywords: cleanedResults.reduce((sum: number, item: any) => sum + item.organic_count, 0)
        });
        
        toast({
          title: "Success",
          description: `Traffic estimation completed for ${cleanedResults.length} domains`,
        });
      } else {
        toast({
          title: "No results",
          description: "No traffic data found for the provided domains",
        });
      }
    } catch (error: any) {
      console.error('Error fetching bulk traffic estimation:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to fetch traffic estimation",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Bulk Traffic Estimation</h1>
        <p className="text-muted-foreground">
          Get traffic estimates for multiple domains or URLs at once.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Bulk Traffic Analysis
          </CardTitle>
          <CardDescription>
            Enter multiple domains or URLs (one per line) to get traffic estimates
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="targets">Domains/URLs (one per line)</Label>
            <Textarea
              id="targets"
              placeholder={`example.com\nhttps://another-site.com\nthird-domain.org`}
              value={targets}
              onChange={(e) => setTargets(e.target.value)}
              className="w-full min-h-[120px]"
            />
            <p className="text-sm text-muted-foreground mt-2">
              Enter domain names without http://, https://, or www. Examples: google.com, github.com, stackoverflow.com
            </p>
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
              disabled={loading || !targets.trim()}
              className="w-full md:w-auto"
            >
              {loading ? "Analyzing..." : "Estimate Traffic"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {metrics && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Analyzed Domains</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.total_domains?.toLocaleString() || "--"}
              </div>
              <p className="text-xs text-muted-foreground">domains processed</p>
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
              <CardTitle className="text-sm font-medium">Total Keywords</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {metrics.total_keywords?.toLocaleString() || "--"}
              </div>
              <p className="text-xs text-muted-foreground">across all domains</p>
            </CardContent>
          </Card>
        </div>
      )}

      <DataTable 
        data={results}
        title="Traffic Estimation Results"
        description="Traffic estimates for all analyzed domains"
        loading={loading}
      />
    </div>
  );
}
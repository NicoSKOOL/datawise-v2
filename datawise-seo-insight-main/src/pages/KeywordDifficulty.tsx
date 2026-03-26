import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { BarChart3 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { DataTable } from "@/components/DataTable";
import { fetchKeywordDifficulty } from "@/lib/dataforseo";

export default function KeywordDifficulty() {
  const [keywords, setKeywords] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const { toast } = useToast();

  const handleAnalyze = async () => {
    if (!keywords.trim()) return;
    
    const keywordList = keywords.trim().split('\n').map(k => k.trim()).filter(k => k);
    if (keywordList.length === 0) return;
    
    setLoading(true);
    setResults([]);
    
    try {
      const data: any = await fetchKeywordDifficulty({
        keywords: keywordList,
        location_code: 2840,
        language_code: 'en'
      });

      if (data?.tasks?.[0]?.result) {
        // Extract individual keyword difficulty items from nested structure
        const flattenedResults = data.tasks[0].result.flatMap((item: any) => {
          if (item.items && Array.isArray(item.items)) {
            return item.items.map((keywordItem: any) => ({
              se_type: keywordItem.se_type,
              keyword: keywordItem.keyword,
              keyword_difficulty: keywordItem.keyword_difficulty
            }));
          }
          return [];
        });
        
        setResults(flattenedResults);
        toast({
          title: "Success",
          description: `Analyzed ${flattenedResults.length} keywords`,
        });
      } else {
        toast({
          title: "No results",
          description: "No difficulty data found for these keywords",
        });
      }
    } catch (error: any) {
      console.error('Error analyzing keyword difficulty:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to analyze keyword difficulty",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Keyword Difficulty</h1>
        <p className="text-muted-foreground">
          Analyze the competition level and ranking difficulty for your target keywords.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Bulk Difficulty Analysis
          </CardTitle>
          <CardDescription>
            Enter multiple keywords (one per line) to analyze their difficulty scores
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="keywords">Keywords (one per line)</Label>
            <Textarea
              id="keywords"
              placeholder="digital marketing&#10;seo tools&#10;content strategy&#10;keyword research"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              rows={6}
              className="resize-none w-full"
            />
          </div>
          <div className="flex justify-start">
            <Button 
              onClick={handleAnalyze} 
              disabled={loading || !keywords.trim()}
              className="w-full md:w-auto"
            >
              {loading ? "Analyzing..." : "Analyze Difficulty"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <DataTable 
        data={results}
        title="Keyword Difficulty Analysis"
        description="Competition scores and difficulty metrics for your keywords"
        loading={loading}
      />
    </div>
  );
}
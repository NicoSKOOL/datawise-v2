import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Loader2, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ReactMarkdown from 'react-markdown';

interface AIAnalysisSummaryProps {
  myDomain: string;
  competitorDomain: string;
  bothRanking: any[];
  gaps: any[];
  advantages: any[];
}

export const AIAnalysisSummary = ({
  myDomain,
  competitorDomain,
  bothRanking,
  gaps,
  advantages
}: AIAnalysisSummaryProps) => {
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const generateAnalysis = async () => {
    setLoading(true);
    
    try {
      const { data, error } = await supabase.functions.invoke('keyword-analysis-ai', {
        body: {
          my_domain: myDomain,
          competitor_domain: competitorDomain,
          both_ranking: bothRanking,
          gaps,
          advantages
        }
      });

      if (error) {
        console.error('AI analysis error:', error);
        throw new Error(error.message || 'Failed to generate analysis');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      setAnalysis(data.analysis);
      toast.success('AI analysis generated!');
    } catch (error: any) {
      console.error('Error generating AI analysis:', error);
      toast.error(error.message || 'Failed to generate AI analysis');
    } finally {
      setLoading(false);
    }
  };

  if (!analysis) {
    return (
      <Card className="border-2 border-primary">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI-Powered Strategic Insights
          </CardTitle>
          <CardDescription>
            Get expert SEO recommendations and actionable insights powered by AI
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button 
            onClick={generateAnalysis} 
            disabled={loading}
            className="w-full"
            size="lg"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Analyzing your keyword data...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Generate AI Analysis
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-primary">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            AI Strategic Analysis
          </CardTitle>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={generateAnalysis}
              disabled={loading}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
        <CardDescription>
          Expert SEO recommendations for {myDomain} vs {competitorDomain}
        </CardDescription>
      </CardHeader>
      {expanded && (
        <CardContent>
          <div className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown>{analysis}</ReactMarkdown>
          </div>
        </CardContent>
      )}
    </Card>
  );
};
import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RefreshCw, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { fetchVisibilitySummary, runVisibilityCheck, type VisibilitySummary } from '@/lib/ai-visibility';

interface GEOVisibilityCardProps {
  domain: string;
  keywords?: string[];
}

export default function GEOVisibilityCard({ domain, keywords = [] }: GEOVisibilityCardProps) {
  const [summary, setSummary] = useState<VisibilitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!domain) { setLoading(false); return; }
    fetchVisibilitySummary(domain)
      .then((res) => {
        if (res.cached && res.data) setSummary(res.data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [domain]);

  const handleCheck = async () => {
    const checkKeywords = keywords.length > 0 ? keywords.slice(0, 3) : [domain];
    setChecking(true);
    try {
      const result = await runVisibilityCheck(domain, checkKeywords);
      setSummary(result);
    } catch { /* handled by UI */ }
    finally { setChecking(false); }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const engines = [
    { key: 'google_ai', label: 'Google AI' },
    { key: 'chatgpt', label: 'ChatGPT' },
    { key: 'perplexity', label: 'Perplexity' },
  ] as const;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Eye className="h-4 w-4" />
          AI Visibility
        </CardTitle>
      </CardHeader>
      <CardContent>
        {summary ? (
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tabular-nums">{summary.engines_visible}/{summary.engines_total}</span>
              <span className="text-xs text-muted-foreground">AI engines</span>
            </div>
            <div className="space-y-1.5">
              {engines.map((engine) => {
                const visible = summary.results.some((r) => r[engine.key]);
                return (
                  <div key={engine.key} className="flex items-center gap-2 text-sm">
                    {visible ? (
                      <CheckCircle className="h-3.5 w-3.5 text-green-500" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                    <span className={visible ? '' : 'text-muted-foreground'}>{engine.label}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              Checked {new Date(summary.checked_at).toLocaleDateString()}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Check if {domain} appears in AI search engines
            </p>
            <Button onClick={handleCheck} disabled={checking} size="sm" variant="outline" className="w-full">
              {checking ? (
                <><RefreshCw className="h-3.5 w-3.5 animate-spin mr-2" />Checking...</>
              ) : (
                'Run AI Visibility Check'
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { fetchDomainRankOverview } from '@/lib/dataforseo';

interface CompetitorComparisonProps {
  domain: string;
}

interface DomainMetrics {
  domain: string;
  organic_keywords: number;
  estimated_traffic: number;
  domain_rank: number;
}

const DOMAIN_COLORS = ['#6366f1', '#f97316', '#10b981'];

export default function CompetitorComparison({ domain }: CompetitorComparisonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [competitor1, setCompetitor1] = useState('');
  const [competitor2, setCompetitor2] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<DomainMetrics[] | null>(null);
  const [error, setError] = useState('');

  const handleCompare = async () => {
    const targets = [domain, competitor1.trim(), competitor2.trim()].filter(Boolean);
    if (targets.length < 2) {
      setError('Enter at least one competitor domain');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const data = await fetchDomainRankOverview({
        targets,
        location_code: 2840,
        language_code: 'en',
      }) as any;

      const tasks = data?.tasks || [];
      const metrics: DomainMetrics[] = [];

      for (const task of tasks) {
        const result = task?.result?.[0];
        if (!result) continue;
        metrics.push({
          domain: result.target || '',
          organic_keywords: result.metrics?.organic?.count || result.metrics?.organic?.pos_1 || 0,
          estimated_traffic: result.metrics?.organic?.etv || 0,
          domain_rank: result.metrics?.organic?.rank || 0,
        });
      }

      if (metrics.length === 0) {
        setError('No data returned for these domains');
      } else {
        setResults(metrics);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch competitor data');
    } finally {
      setLoading(false);
    }
  };

  const chartData = results ? [
    {
      metric: 'Organic Keywords',
      ...Object.fromEntries(results.map(r => [r.domain, r.organic_keywords])),
    },
    {
      metric: 'Est. Traffic',
      ...Object.fromEntries(results.map(r => [r.domain, r.estimated_traffic])),
    },
    {
      metric: 'Domain Rank',
      ...Object.fromEntries(results.map(r => [r.domain, r.domain_rank])),
    },
  ] : [];

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Competitor Comparison</CardTitle>
          {isOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </CardHeader>

      {isOpen && (
        <CardContent className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Your domain</label>
              <Input value={domain} disabled className="text-sm h-8 bg-muted" />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Competitor 1</label>
              <Input
                value={competitor1}
                onChange={(e) => setCompetitor1(e.target.value)}
                placeholder="competitor.com"
                className="text-sm h-8"
              />
            </div>
            <div className="flex-1">
              <label className="text-xs text-muted-foreground mb-1 block">Competitor 2 (optional)</label>
              <Input
                value={competitor2}
                onChange={(e) => setCompetitor2(e.target.value)}
                placeholder="another.com"
                className="text-sm h-8"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleCompare} disabled={loading} size="sm">
                {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Compare'}
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          {results && chartData.length > 0 && (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 20, left: 80, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f0f0" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="metric" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} width={100} />
                <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '12px', border: '1px solid #e5e7eb' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: '11px' }} />
                {results.map((r, i) => (
                  <Bar key={r.domain} dataKey={r.domain} fill={DOMAIN_COLORS[i]} radius={[0, 4, 4, 0]} barSize={16} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      )}
    </Card>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as ChartTooltip, ResponsiveContainer, Legend } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, Plus, Trash2, Sparkles } from 'lucide-react';
import {
  fetchAITracking, updateAISettings, addAIQueries, deleteAIQuery, runAICheck, fetchAIReport,
  AI_ENGINE_LABELS,
  type AIEngine, type AITrackingData, type AIReport, type AIEngineResult,
} from '@/lib/ai-tracking';

const ENGINE_ORDER: AIEngine[] = ['google_ai_mode', 'chatgpt', 'perplexity'];
const ENGINE_COLORS: Record<AIEngine, string> = {
  google_ai_mode: '#005232',
  chatgpt: '#0ea5e9',
  perplexity: '#8b5cf6',
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function StatusBadge({ result }: { result?: AIEngineResult }) {
  if (!result) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  switch (result.status) {
    case 'cited':
      return (
        <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100" title={result.cited_url || undefined}>
          Cited{result.citation_position ? ` #${result.citation_position}` : ''}
        </Badge>
      );
    case 'mentioned':
      return (
        <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100" title={result.answer_excerpt || undefined}>
          Mentioned
        </Badge>
      );
    case 'absent':
      return <Badge variant="secondary" className="text-muted-foreground">Absent</Badge>;
    case 'no_answer':
      return <Badge variant="outline" className="text-muted-foreground">No AI answer</Badge>;
    default:
      return <Badge variant="outline" className="text-red-600 border-red-200">Error</Badge>;
  }
}

interface AIVisibilityPanelProps {
  project: { id: string; domain: string };
  trackedKeywords: string[];
}

export default function AIVisibilityPanel({ project, trackedKeywords }: AIVisibilityPanelProps) {
  const [data, setData] = useState<AITrackingData | null>(null);
  const [report, setReport] = useState<AIReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(false);
  const [newQuery, setNewQuery] = useState('');
  const [brandTermsInput, setBrandTermsInput] = useState('');
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const tracking = await fetchAITracking(project.id);
      setData(tracking);
      setBrandTermsInput(tracking.settings.brand_terms.join(', '));
      if (tracking.settings.enabled) {
        const r = await fetchAIReport(project.id, 90);
        setReport(r);
      }
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [project.id, toast]);

  useEffect(() => { void load(); }, [load]);

  const settings = data?.settings;
  const queries = data?.queries || [];
  const atCap = settings ? queries.length >= settings.max_queries : false;

  const quickAddOptions = useMemo(() => {
    const existing = new Set(queries.map(q => q.query_text.toLowerCase()));
    return trackedKeywords.filter(kw => !existing.has(kw.toLowerCase())).slice(0, 10);
  }, [trackedKeywords, queries]);

  const trendData = useMemo(() => {
    if (!report?.trend.length) return [];
    const byDate = new Map<string, Record<string, number | string>>();
    for (const point of report.trend) {
      if (!byDate.has(point.date)) {
        byDate.set(point.date, {
          date: new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        });
      }
      const row = byDate.get(point.date)!;
      row[point.engine] = point.total ? Math.round(((point.cited + point.mentioned) / point.total) * 100) : 0;
    }
    return Array.from(byDate.values());
  }, [report]);

  const setEnabled = async (enabled: boolean) => {
    setSaving(true);
    try {
      setData(await updateAISettings(project.id, { enabled }));
      if (enabled) {
        toast({ title: 'AI tracking enabled', description: 'Queries are checked automatically every Monday. Run a manual check to get your first data now.' });
      }
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const toggleEngine = async (engine: AIEngine, on: boolean) => {
    if (!settings) return;
    const engines = on ? [...settings.engines, engine] : settings.engines.filter(e => e !== engine);
    if (!engines.length) {
      toast({ title: 'At least one engine is required', variant: 'destructive' });
      return;
    }
    setSaving(true);
    try {
      setData(await updateAISettings(project.id, { engines }));
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const saveBrandTerms = async () => {
    const terms = brandTermsInput.split(',').map(t => t.trim()).filter(Boolean);
    setSaving(true);
    try {
      setData(await updateAISettings(project.id, { brand_terms: terms }));
      toast({ title: 'Brand terms saved' });
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const addQueries = async (texts: string[]) => {
    const cleaned = texts.map(t => t.trim()).filter(Boolean);
    if (!cleaned.length) return;
    try {
      const result = await addAIQueries(project.id, cleaned.map(text => ({ text })));
      if (result.added === 0 && result.remaining === 0) {
        toast({ title: 'Query limit reached', description: `Max ${settings?.max_queries} tracked AI queries per project.`, variant: 'destructive' });
      }
      setNewQuery('');
      await load();
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const removeQuery = async (queryId: string) => {
    try {
      await deleteAIQuery(queryId);
      await load();
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      const summary = await runAICheck(project.id);
      toast({
        title: 'AI check complete',
        description: `${summary.checks} checks: ${summary.cited} cited, ${summary.mentioned} mentioned${summary.skipped_fresh ? ` (${summary.skipped_fresh} skipped, checked within 24h)` : ''}.`,
      });
      await load();
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setChecking(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!settings) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Search Visibility
          </CardTitle>
          <CardDescription className="mt-1">
            Track whether AI answers cite {project.domain} for your key queries. Checked automatically every Monday across {settings.engines.map(e => AI_ENGINE_LABELS[e]).join(', ')}.
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          {settings.enabled && (
            <Button size="sm" onClick={checkNow} disabled={checking || queries.length === 0}>
              <RefreshCw className={`h-4 w-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
              {checking ? 'Checking…' : 'Check now'}
            </Button>
          )}
          <Switch checked={settings.enabled} onCheckedChange={setEnabled} disabled={saving} />
        </div>
      </CardHeader>

      {settings.enabled && (
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Brand terms (for mention detection)</Label>
              <div className="flex gap-2">
                <Input
                  value={brandTermsInput}
                  onChange={(e) => setBrandTermsInput(e.target.value)}
                  placeholder="e.g. DataWise, datawiseseo"
                />
                <Button variant="secondary" onClick={saveBrandTerms} disabled={saving}>Save</Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Engines</Label>
              <div className="flex items-center gap-5 h-10">
                {ENGINE_ORDER.map(engine => (
                  <label key={engine} className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={settings.engines.includes(engine)}
                      onCheckedChange={(on) => toggleEngine(engine, on === true)}
                      disabled={saving}
                    />
                    {AI_ENGINE_LABELS[engine]}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Tracked AI queries ({queries.length}/{settings.max_queries})
              </Label>
            </div>

            {queries.length > 0 && (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-secondary/50 text-left">
                      <th className="px-4 py-2 font-medium">Query</th>
                      {ENGINE_ORDER.filter(e => settings.engines.includes(e)).map(engine => (
                        <th key={engine} className="px-4 py-2 font-medium">{AI_ENGINE_LABELS[engine]}</th>
                      ))}
                      <th className="px-2 py-2 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {queries.map(query => (
                      <tr key={query.id} className="border-b last:border-0">
                        <td className="px-4 py-2.5">{query.query_text}</td>
                        {ENGINE_ORDER.filter(e => settings.engines.includes(e)).map(engine => (
                          <td key={engine} className="px-4 py-2.5">
                            <StatusBadge result={query.engines[engine]} />
                          </td>
                        ))}
                        <td className="px-2 py-2.5">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeQuery(query.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!atCap && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={newQuery}
                    onChange={(e) => setNewQuery(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void addQueries([newQuery]); }}
                    placeholder='Add a keyword or a natural-language prompt, e.g. "best rank tracking tool for small agencies"'
                  />
                  <Button variant="secondary" onClick={() => addQueries([newQuery])} disabled={!newQuery.trim()}>
                    <Plus className="h-4 w-4 mr-1" /> Add
                  </Button>
                </div>
                {quickAddOptions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-xs text-muted-foreground mr-1">From tracked keywords:</span>
                    {quickAddOptions.map(kw => (
                      <button
                        key={kw}
                        type="button"
                        onClick={() => addQueries([kw])}
                        className="text-xs px-2 py-0.5 rounded-full border bg-secondary/50 hover:bg-secondary transition-colors"
                      >
                        + {kw}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {trendData.length > 1 && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Visibility trend (% of queries cited or mentioned)
              </Label>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} unit="%" />
                  <ChartTooltip contentStyle={{ borderRadius: '8px', fontSize: '12px', border: '1px solid #e5e7eb' }} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
                  {ENGINE_ORDER.filter(e => settings.engines.includes(e)).map(engine => (
                    <Line
                      key={engine}
                      type="monotone"
                      dataKey={engine}
                      name={AI_ENGINE_LABELS[engine]}
                      stroke={ENGINE_COLORS[engine]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      connectNulls
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {report && report.share_of_voice.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                Share of voice: domains AI answers cite for your queries (last {report.period} days)
              </Label>
              <div className="space-y-1.5">
                {(() => {
                  const max = Math.max(...report.share_of_voice.map(r => r.citations), 1);
                  return report.share_of_voice.slice(0, 10).map(row => (
                    <div key={row.domain} className="flex items-center gap-3 text-sm">
                      <span className={`w-48 truncate ${row.is_you ? 'font-semibold text-primary' : ''}`} title={row.domain}>
                        {row.domain}{row.is_you ? ' (you)' : ''}
                      </span>
                      <div className="flex-1 h-2.5 rounded-full bg-secondary overflow-hidden">
                        <div
                          className={`h-full rounded-full ${row.is_you ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                          style={{ width: `${Math.max(4, Math.round((row.citations / max) * 100))}%` }}
                        />
                      </div>
                      <span className="w-20 text-right text-xs text-muted-foreground">
                        {row.citations} citation{row.citations === 1 ? '' : 's'}
                      </span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}

          {queries.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Add up to {settings.max_queries} queries to start tracking. Use your tracked keywords or phrase questions the way customers ask AI assistants.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}

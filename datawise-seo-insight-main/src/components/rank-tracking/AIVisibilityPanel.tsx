import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, Plus, Sparkles, Settings2 } from 'lucide-react';
import {
  fetchAITracking, updateAISettings, addAIQueries, deleteAIQuery, runAICheck, fetchAIReport,
  AI_ENGINE_LABELS,
  type AIEngine, type AITrackingData, type AIReport,
} from '@/lib/ai-tracking';
import VerdictStrip from './ai/VerdictStrip';
import QueryCard from './ai/QueryCard';
import CitedTermsTab from './ai/CitedTermsTab';
import ShareOfVoiceFooter from './ai/ShareOfVoiceFooter';

const ENGINE_ORDER: AIEngine[] = ['google_ai_mode', 'chatgpt', 'perplexity'];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

// checked_at is a UTC "YYYY-MM-DD HH:MM:SS" string from D1.
function timeAgo(sqlUtc: string): string {
  const ts = new Date(sqlUtc.replace(' ', 'T') + (sqlUtc.endsWith('Z') ? '' : 'Z')).getTime();
  if (Number.isNaN(ts)) return sqlUtc;
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
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
  const [activeTab, setActiveTab] = useState<'tracked' | 'cited'>('tracked');
  const [period, setPeriod] = useState<7 | 30 | 90>(90);
  const [showSettings, setShowSettings] = useState(false);
  const autoCheckRan = useRef(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const tracking = await fetchAITracking(project.id);
      setData(tracking);
      setBrandTermsInput(tracking.settings.brand_terms.join(', '));
      if (tracking.settings.enabled) {
        const r = await fetchAIReport(project.id, period);
        setReport(r);
      }
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [project.id, period, toast]);

  useEffect(() => { void load(); }, [load]);

  const settings = data?.settings;
  const queries = useMemo(() => data?.queries || [], [data]);
  const atCap = settings ? queries.length >= settings.max_queries : false;
  const enabledEngines = useMemo(
    () => ENGINE_ORDER.filter(e => settings?.engines.includes(e)),
    [settings],
  );

  const quickAddOptions = useMemo(() => {
    const existing = new Set(queries.map(q => q.query_text.toLowerCase()));
    return trackedKeywords.filter(kw => !existing.has(kw.toLowerCase())).slice(0, 10);
  }, [trackedKeywords, queries]);

  const trackedQueryTexts = useMemo(
    () => new Set(queries.map(q => q.query_text.trim().toLowerCase())),
    [queries],
  );

  // Latest check timestamp across every query and engine. Null means this
  // project has never been checked (fresh setup waiting for its first data).
  const lastCheckedAt = useMemo(() => {
    let latest: string | null = null;
    for (const q of queries) {
      for (const result of Object.values(q.engines)) {
        if (result?.checked_at && (!latest || result.checked_at > latest)) latest = result.checked_at;
      }
    }
    return latest;
  }, [queries]);
  const hasAnyChecks = lastCheckedAt !== null;

  const setEnabled = async (enabled: boolean) => {
    setSaving(true);
    try {
      setData(await updateAISettings(project.id, { enabled }));
      if (enabled) {
        toast({ title: 'AI tracking enabled', description: 'Queries are checked automatically every Monday. Your first check runs as soon as you have queries tracked.' });
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

  const trackDiscoveredQuery = async (text: string) => {
    try {
      const result = await addAIQueries(project.id, [{ text, source: 'discovery' }]);
      if (result.added === 0 && result.remaining === 0) {
        toast({ title: 'Query limit reached', description: `Max ${settings?.max_queries} tracked AI queries per project.`, variant: 'destructive' });
      }
      await load();
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    }
  };

  const checkNow = useCallback(async (firstRun = false) => {
    setChecking(true);
    try {
      const summary = await runAICheck(project.id);
      toast({
        title: firstRun ? 'First AI check complete' : 'AI check complete',
        description: `${summary.checks} checks: ${summary.cited} cited, ${summary.mentioned} mentioned${summary.skipped_fresh ? ` (${summary.skipped_fresh} skipped, checked within 24h)` : ''}.`,
      });
      await load();
    } catch (err: unknown) {
      toast({ title: 'Error', description: getErrorMessage(err), variant: 'destructive' });
    } finally {
      setChecking(false);
    }
  }, [project.id, load, toast]);

  // First-visit data push: a project with tracked queries but no checks yet
  // would otherwise show an empty report until the Monday cron. Run the first
  // check automatically, once per mount; the server skips anything checked in
  // the last 24h, so this never double-spends.
  useEffect(() => {
    if (loading || checking || autoCheckRan.current) return;
    if (!settings?.enabled || queries.length === 0 || hasAnyChecks) return;
    autoCheckRan.current = true;
    void checkNow(true);
  }, [loading, checking, settings?.enabled, queries.length, hasAnyChecks, checkNow]);

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
      <CardHeader className="space-y-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-primary" />
              AI Search Visibility
            </CardTitle>
            <CardDescription className="mt-1">
              Track whether AI answers cite {project.domain} for your key queries across {settings.engines.map(e => AI_ENGINE_LABELS[e]).join(', ')}.
            </CardDescription>
            {settings.enabled && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {lastCheckedAt ? `Last checked ${timeAgo(lastCheckedAt)}` : 'Never checked yet'} · runs automatically every Monday, or check manually anytime (results under 24h old are not re-checked).
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {settings.enabled && (
              <>
                <Button size="sm" onClick={() => checkNow()} disabled={checking || queries.length === 0}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
                  {checking ? 'Checking…' : 'Check now'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowSettings(s => !s)}
                  aria-label="Tracking settings"
                  className={showSettings ? 'bg-secondary' : ''}
                >
                  <Settings2 className="h-4 w-4" />
                </Button>
              </>
            )}
            <Switch checked={settings.enabled} onCheckedChange={setEnabled} disabled={saving} />
          </div>
        </div>
      </CardHeader>

      {settings.enabled && (
        <CardContent className="space-y-6">
          {checking && !hasAnyChecks && (
            <div className="flex items-start gap-3 rounded-lg border bg-secondary/40 px-4 py-3">
              <RefreshCw className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-primary" />
              <div className="text-sm">
                <p className="font-medium">Running your first AI check…</p>
                <p className="text-muted-foreground">
                  Asking {enabledEngines.map(e => AI_ENGINE_LABELS[e]).join(', ')} your {queries.length} tracked {queries.length === 1 ? 'query' : 'queries'} and recording who gets cited. This can take a minute or two; the report fills in when it finishes.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-1">
            <span className="mr-1 text-xs text-muted-foreground">Trend range</span>
            {([7, 30, 90] as const).map(days => (
              <button
                key={days}
                type="button"
                onClick={() => setPeriod(days)}
                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                  period === days ? 'bg-[#005232] text-white' : 'bg-secondary text-foreground hover:bg-secondary/70'
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
          <VerdictStrip queries={queries} trend={report?.trend || []} engines={enabledEngines} />

          <div className="flex gap-2">
            <button
              type="button"
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${activeTab === 'tracked' ? 'bg-[#005232] text-white' : 'bg-secondary text-foreground'}`}
              onClick={() => setActiveTab('tracked')}
            >
              Tracked queries ({queries.length})
            </button>
            <button
              type="button"
              className={`rounded-lg px-4 py-1.5 text-sm font-semibold ${activeTab === 'cited' ? 'bg-[#005232] text-white' : 'bg-secondary text-foreground'}`}
              onClick={() => setActiveTab('cited')}
            >
              Terms you're cited for
            </button>
          </div>

          {activeTab === 'tracked' && (
            <div className="space-y-3">
              {queries.map(query => (
                <QueryCard
                  key={query.id}
                  query={query}
                  engines={enabledEngines}
                  projectDomain={project.domain}
                  onDelete={removeQuery}
                />
              ))}

              {queries.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Add up to {settings.max_queries} queries to start tracking, phrased the way customers ask AI assistants. Your first check runs automatically as soon as you add them.
                </p>
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
          )}

          {activeTab === 'cited' && (
            <CitedTermsTab
              domain={project.domain}
              trackedQueryTexts={trackedQueryTexts}
              onTrack={trackDiscoveredQuery}
            />
          )}

          <ShareOfVoiceFooter share={report?.share_of_voice || []} domain={project.domain} />

          {showSettings && (
          <div className="grid gap-4 md:grid-cols-2 border-t pt-4">
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
          )}
        </CardContent>
      )}
    </Card>
  );
}

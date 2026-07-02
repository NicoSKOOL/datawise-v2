import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, Sparkles, Settings2 } from 'lucide-react';
import {
  fetchAITracking, updateAISettings, addAIQueries, deleteAIQuery, runAICheck, fetchAIReport,
  AI_ENGINE_LABELS, AI_ENGINE_ORDER,
  type AIEngine, type AITrackingData, type AIReport,
} from '@/lib/ai-tracking';
import EngineLogo from './ai/EngineLogo';
import KpiRail from './ai/KpiRail';
import AnswerStatusMatrix from './ai/AnswerStatusMatrix';
import { TrendMiniCard, ShareOfVoiceCard, ActionsCard, nextMondayCheck } from './ai/RightRail';
import CitedTermsTab from './ai/CitedTermsTab';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

// D1 UTC "YYYY-MM-DD HH:MM:SS" -> "Mon, Jun 29 · 06:04 UTC"
function formatCheckStamp(sqlUtc: string): string {
  const d = new Date(sqlUtc.replace(' ', 'T') + (sqlUtc.endsWith('Z') ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return sqlUtc;
  const date = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  return `${date} · ${time} UTC`;
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
  const [brandTermsInput, setBrandTermsInput] = useState('');
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
  const enabledEngines = useMemo(
    () => AI_ENGINE_ORDER.filter(e => settings?.engines.includes(e)),
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
    <div className="space-y-3">
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Search Visibility
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Tracking how AI assistants answer your customers' questions for <span className="font-semibold text-foreground">{project.domain}</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          {settings.enabled && (
            <div className="hidden flex-col items-end gap-0.5 sm:flex">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-[#1F7A43]" />
                {lastCheckedAt ? `Checked ${formatCheckStamp(lastCheckedAt)}` : 'Never checked yet'}
              </div>
              <div className="text-[11px] text-muted-foreground">Next auto-check {nextMondayCheck()} · 06:00 UTC</div>
            </div>
          )}
          {settings.enabled && (
            <>
              <Button size="sm" className="rounded-full" onClick={() => checkNow()} disabled={checking || queries.length === 0}>
                <RefreshCw className={`mr-2 h-4 w-4 ${checking ? 'animate-spin' : ''}`} />
                {checking ? 'Checking…' : 'Check now · 1 credit'}
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

      {settings.enabled && (
        <>
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

          {showSettings && (
            <Card>
              <CardContent className="grid gap-4 p-4 md:grid-cols-2">
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
                  <div className="flex h-10 items-center gap-5">
                    {AI_ENGINE_ORDER.map(engine => (
                      <label key={engine} className="flex cursor-pointer items-center gap-2 text-sm">
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
              </CardContent>
            </Card>
          )}

          {/* Brand terms + engines strip */}
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-semibold text-foreground/80">Brand terms</span>
            {settings.brand_terms.length > 0 ? settings.brand_terms.map(term => (
              <span key={term} className="rounded-full border bg-card px-2.5 py-0.5 text-foreground/80">{term}</span>
            )) : (
              <span className="italic">using defaults from your domain</span>
            )}
            <button type="button" className="font-semibold text-[#1F7A43] hover:text-[#166337]" onClick={() => setShowSettings(true)}>Edit</button>
            <span className="mx-1 h-4 w-px bg-border" />
            <span className="font-semibold text-foreground/80">Engines</span>
            {enabledEngines.map(engine => (
              <span key={engine} className="inline-flex items-center gap-1.5">
                <EngineLogo engine={engine} className="h-3.5 w-3.5" />
                {AI_ENGINE_LABELS[engine]}
              </span>
            ))}
          </div>

          <KpiRail queries={queries} engines={enabledEngines} trend={report?.trend || []} />

          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_340px]">
            <AnswerStatusMatrix
              queries={queries}
              engines={enabledEngines}
              projectDomain={project.domain}
              maxQueries={settings.max_queries}
              quickAddOptions={quickAddOptions}
              onAdd={addQueries}
              onDelete={removeQuery}
            />
            <div className="flex flex-col gap-3">
              <TrendMiniCard trend={report?.trend || []} engines={enabledEngines} period={period} onPeriodChange={setPeriod} />
              <ShareOfVoiceCard share={report?.share_of_voice || []} />
              <ActionsCard queries={queries} />
            </div>
          </div>

          <Card>
            <CardContent className="flex flex-col gap-3 p-5">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Terms you're cited for</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Prompts from the historical LLM index that already cite {project.domain}, ones you are not tracking yet. The index runs days to weeks behind, so a fresh check can differ.
                </p>
              </div>
              <CitedTermsTab
                domain={project.domain}
                trackedQueryTexts={trackedQueryTexts}
                onTrack={trackDiscoveredQuery}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Sparkles, Copy, AlertTriangle, RefreshCw, ListPlus, Check } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import {
  rewriteMeta,
  type MetaRewriteIssueType,
  type MetaRewritePageContext,
  type MetaRewriteResponse,
} from '@/lib/meta-rewrite';
import { OutOfCreditsError } from '@/lib/api';
import { TITLE_MIN, TITLE_MAX, META_MIN, META_MAX } from '@/lib/meta-checker';
import { createTask } from '@/lib/site-audit';
import { useProperty } from '@/contexts/PropertyContext';

interface MetaRewriteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  currentTitle: string | null;
  currentDescription: string | null;
  issueType: MetaRewriteIssueType;
  // Optional pre-fetched context (Site Audit passes this; Meta Checker omits).
  context?: MetaRewritePageContext;
  // Best-effort initial keyword guess for the input field. The server will
  // re-infer from page context if this is empty.
  initialKeyword?: string;
  onOutOfCredits?: () => void;
  // Optional audit to attach the task to. If null/omitted, task is standalone
  // under the property (matches the "No audit" behaviour in Meta Checker).
  auditId?: string | null;
}

function shortPath(u: string): string {
  try {
    const parsed = new URL(u);
    return parsed.pathname + (parsed.search || '');
  } catch {
    return u;
  }
}

function lengthTone(len: number, min: number, max: number): string {
  if (len === 0) return 'text-muted-foreground';
  if (len < min) return 'text-blue-600';
  if (len > max) return 'text-amber-600';
  return 'text-emerald-600';
}

export function MetaRewriteDialog(props: MetaRewriteDialogProps) {
  const {
    open, onOpenChange, url, currentTitle, currentDescription, issueType,
    context, initialKeyword = '', onOutOfCredits, auditId,
  } = props;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { selectedPropertyId } = useProperty();

  const [keyword, setKeyword] = useState(initialKeyword);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<MetaRewriteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [sentToBoard, setSentToBoard] = useState(false);

  // Reset state when the dialog target changes.
  useEffect(() => {
    if (open) {
      setKeyword(initialKeyword);
      setResult(null);
      setError(null);
      setHasGenerated(false);
      setSentToBoard(false);
    }
  }, [open, url, initialKeyword]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await rewriteMeta({
        url,
        current_title: currentTitle,
        current_description: currentDescription,
        issue_type: issueType,
        target_keyword: keyword.trim() || undefined,
        context,
      });
      setResult(res);
      // If we inferred the keyword server-side, surface it in the input.
      if (!keyword.trim() && res.target_keyword) setKeyword(res.target_keyword);
      setHasGenerated(true);
    } catch (err) {
      if (err instanceof OutOfCreditsError) {
        onOutOfCredits?.();
        onOpenChange(false);
        return;
      }
      const msg = err instanceof Error ? err.message : 'Rewrite failed';
      if (msg === 'NO_LLM_KEY') {
        setError('Add your LLM API key in Settings to use AI rewrite.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  async function acceptToBoard() {
    if (!result) return;
    if (!selectedPropertyId) {
      toast({
        variant: 'destructive',
        title: 'Select a website first',
        description: 'Pick a property from the sidebar selector to create tasks.',
      });
      return;
    }
    setAccepting(true);
    try {
      await createTask({
        property_id: selectedPropertyId,
        audit_id: auditId ?? null,
        title: `Rewrite meta on ${shortPath(url)}`,
        category: 'Meta',
        priority: 'medium',
        status: 'todo',
        url,
        how_to_fix:
          `Replace the current title and meta description on ${url} with the AI-generated copy below.\n\n` +
          `New title (${result.title_length} chars):\n${result.title}\n\n` +
          `New meta description (${result.description_length} chars):\n${result.description}` +
          (result.reasoning ? `\n\nReasoning: ${result.reasoning}` : ''),
        subtasks: [
          { id: `t-${Math.random().toString(36).slice(2, 8)}`, text: `Apply new title: ${result.title}`, url, done: false },
          { id: `d-${Math.random().toString(36).slice(2, 8)}`, text: `Apply new meta description: ${result.description}`, url, done: false },
        ],
      });
      setSentToBoard(true);
      qc.invalidateQueries({ queryKey: ['tasks'] });
      toast({ title: 'Sent to board', description: 'Tracked as a Site Audit task.' });
    } catch (err) {
      toast({
        variant: 'destructive',
        title: 'Failed to create task',
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setAccepting(false);
    }
  }

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Rewrite title and meta description
          </DialogTitle>
          <DialogDescription className="font-mono text-xs truncate">{url}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Current values */}
          <div className="space-y-2 rounded-md border bg-muted/20 p-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Current title</div>
              <div className="text-sm">
                {currentTitle || <span className="italic text-muted-foreground">(none)</span>}
                {currentTitle && (
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    {[...currentTitle].length} chars
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">Current description</div>
              <div className="text-sm">
                {currentDescription || <span className="italic text-muted-foreground">(none)</span>}
                {currentDescription && (
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    {[...currentDescription].length} chars
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Keyword input */}
          <div className="space-y-1.5">
            <Label htmlFor="meta-rewrite-keyword" className="text-xs">
              Target keyword <span className="text-muted-foreground font-normal">(leave blank to auto-infer from page content)</span>
            </Label>
            <Input
              id="meta-rewrite-keyword"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="e.g. running shoes for flat feet"
              disabled={loading}
            />
          </div>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-600">
              {error}
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="space-y-3">
              {result.length_warning && (
                <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
                  <span>The model could not stay inside the recommended length on the last attempt. Tighten manually before publishing.</span>
                </div>
              )}

              {/* Proposed title */}
              <div className="rounded-md border p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Proposed title</div>
                  <span className={`font-mono text-[10px] ${lengthTone(result.title_length, TITLE_MIN, TITLE_MAX)}`}>
                    {result.title_length} / {TITLE_MAX} chars
                  </span>
                </div>
                <div className="text-sm font-medium">{result.title}</div>
                <Button size="sm" variant="outline" onClick={() => copy(result.title, 'Title')}>
                  <Copy className="h-3 w-3 mr-1.5" /> Copy title
                </Button>
              </div>

              {/* Proposed description */}
              <div className="rounded-md border p-3 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Proposed description</div>
                  <span className={`font-mono text-[10px] ${lengthTone(result.description_length, META_MIN, META_MAX)}`}>
                    {result.description_length} / {META_MAX} chars
                  </span>
                </div>
                <div className="text-sm">{result.description}</div>
                <Button size="sm" variant="outline" onClick={() => copy(result.description, 'Description')}>
                  <Copy className="h-3 w-3 mr-1.5" /> Copy description
                </Button>
              </div>

              {result.reasoning && (
                <div className="text-xs text-muted-foreground italic">
                  {result.reasoning}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 flex-wrap">
          {hasGenerated && (
            <span className="text-[10px] text-muted-foreground self-center mr-auto">
              Each generation uses 1 credit.
            </span>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading || accepting}>
            Close
          </Button>
          <Button onClick={generate} disabled={loading || accepting} variant={result ? 'outline' : 'default'}>
            {loading ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Generating...</>
            ) : hasGenerated ? (
              <><RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Regenerate</>
            ) : (
              <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> Generate</>
            )}
          </Button>
          {result && (
            <Button onClick={acceptToBoard} disabled={accepting || sentToBoard || !selectedPropertyId}>
              {accepting ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Sending...</>
              ) : sentToBoard ? (
                <><Check className="h-3.5 w-3.5 mr-1.5" /> Sent to board</>
              ) : (
                <><ListPlus className="h-3.5 w-3.5 mr-1.5" /> Accept & send to board</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

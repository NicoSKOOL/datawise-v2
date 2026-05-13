import { Loader2, Sparkles, Copy, AlertTriangle, Check, X, ListPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { TITLE_MIN, TITLE_MAX, META_MIN, META_MAX } from '@/lib/meta-checker';
import type { MetaRewriteResponse } from '@/lib/meta-rewrite';

export type BulkStatus = 'pending' | 'running' | 'done' | 'error';

export interface BulkRewriteEntry {
  url: string;
  current_title: string | null;
  current_description: string | null;
  status: BulkStatus;
  result?: MetaRewriteResponse;
  error?: string;
  sent_to_board?: boolean;
}

interface Props {
  entries: BulkRewriteEntry[];
  onAcceptOne: (entry: BulkRewriteEntry) => Promise<void> | void;
  onAcceptAll: () => Promise<void> | void;
  onDismiss: () => void;
  acceptingAll?: boolean;
  acceptingUrls?: Set<string>;
  hasBoardTarget: boolean;
}

function shortPath(u: string): string {
  try {
    const p = new URL(u);
    return p.pathname + (p.search || '');
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

export function BulkRewritesPanel(props: Props) {
  const { entries, onAcceptOne, onAcceptAll, onDismiss, acceptingAll, acceptingUrls, hasBoardTarget } = props;
  const { toast } = useToast();

  const doneCount = entries.filter((e) => e.status === 'done').length;
  const runningCount = entries.filter((e) => e.status === 'running' || e.status === 'pending').length;
  const errorCount = entries.filter((e) => e.status === 'error').length;
  const acceptedCount = entries.filter((e) => e.sent_to_board).length;
  const acceptableCount = entries.filter((e) => e.status === 'done' && !e.sent_to_board).length;

  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: 'Copy failed', variant: 'destructive' });
    }
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
          <h3 className="text-sm font-semibold">AI rewrites</h3>
          <span className="text-xs text-muted-foreground">
            {doneCount} ready
            {runningCount > 0 && ` · ${runningCount} running`}
            {errorCount > 0 && ` · ${errorCount} failed`}
            {acceptedCount > 0 && ` · ${acceptedCount} sent to board`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={onAcceptAll}
            disabled={acceptableCount === 0 || acceptingAll || !hasBoardTarget}
            className="gap-1.5"
          >
            {acceptingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus className="h-3.5 w-3.5" />}
            Accept all{acceptableCount > 0 ? ` (${acceptableCount})` : ''}
          </Button>
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {!hasBoardTarget && (
        <div className="px-4 py-2 border-b bg-amber-500/5 text-[11px] text-amber-700">
          Pick a website (sidebar selector) before accepting rewrites — board tasks need a property to attach to.
        </div>
      )}

      <div className="divide-y">
        {entries.map((entry) => (
          <BulkRewriteRow
            key={entry.url}
            entry={entry}
            onAccept={() => onAcceptOne(entry)}
            onCopy={copy}
            accepting={acceptingUrls?.has(entry.url) ?? false}
            hasBoardTarget={hasBoardTarget}
          />
        ))}
      </div>
    </div>
  );
}

function BulkRewriteRow({
  entry,
  onAccept,
  onCopy,
  accepting,
  hasBoardTarget,
}: {
  entry: BulkRewriteEntry;
  onAccept: () => void;
  onCopy: (v: string, label: string) => void;
  accepting: boolean;
  hasBoardTarget: boolean;
}) {
  const { status, result, error, sent_to_board } = entry;

  return (
    <div className="px-4 py-3 space-y-2">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="font-mono text-xs truncate min-w-0 text-primary">
          {shortPath(entry.url)}
        </div>
        <div className="flex items-center gap-2">
          {status === 'pending' && (
            <Badge variant="outline" className="text-[10px]">Queued</Badge>
          )}
          {status === 'running' && (
            <Badge variant="outline" className="text-[10px] gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Generating
            </Badge>
          )}
          {status === 'error' && (
            <Badge variant="outline" className="text-[10px] border-red-500/40 text-red-600 bg-red-500/5">
              Failed
            </Badge>
          )}
          {status === 'done' && result?.length_warning && (
            <Badge variant="outline" className="text-[10px] gap-1 border-amber-500/40 text-amber-600 bg-amber-500/5">
              <AlertTriangle className="h-2.5 w-2.5" /> Length warning
            </Badge>
          )}
          {sent_to_board && (
            <Badge variant="outline" className="text-[10px] gap-1 border-emerald-500/40 text-emerald-600 bg-emerald-500/5">
              <Check className="h-2.5 w-2.5" /> On board
            </Badge>
          )}
        </div>
      </div>

      {status === 'error' && error && (
        <div className="text-xs text-red-600">{error}</div>
      )}

      {status === 'done' && result && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="rounded-md border p-2.5 space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Title</div>
              <span className={`font-mono text-[10px] ${lengthTone(result.title_length, TITLE_MIN, TITLE_MAX)}`}>
                {result.title_length} / {TITLE_MAX}
              </span>
            </div>
            <div className="text-xs font-medium">{result.title}</div>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onCopy(result.title, 'Title')}>
              <Copy className="h-3 w-3 mr-1" /> Copy
            </Button>
          </div>
          <div className="rounded-md border p-2.5 space-y-1">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Description</div>
              <span className={`font-mono text-[10px] ${lengthTone(result.description_length, META_MIN, META_MAX)}`}>
                {result.description_length} / {META_MAX}
              </span>
            </div>
            <div className="text-xs">{result.description}</div>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => onCopy(result.description, 'Description')}>
              <Copy className="h-3 w-3 mr-1" /> Copy
            </Button>
          </div>
          {result.reasoning && (
            <div className="md:col-span-2 text-[11px] text-muted-foreground italic">
              {result.reasoning}
            </div>
          )}
          <div className="md:col-span-2 flex items-center justify-end">
            <Button
              size="sm"
              variant={sent_to_board ? 'ghost' : 'outline'}
              onClick={onAccept}
              disabled={sent_to_board || accepting || !hasBoardTarget}
              className="gap-1.5"
            >
              {accepting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : sent_to_board ? (
                <Check className="h-3.5 w-3.5" />
              ) : (
                <ListPlus className="h-3.5 w-3.5" />
              )}
              {sent_to_board ? 'Sent to board' : 'Accept & send to board'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { INTENT_LABELS, INTENT_ORDER, type PlannerIntent } from '@/lib/planner';

// Custom keywords and content ideas typed straight into the planner
// (feature request 1f854f2b). Saved with source 'manual' and no metrics.

export const MAX_MANUAL_KEYWORDS = 200;

export function parseManualKeywords(input: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of input.split(/[\n,]/)) {
    const keyword = line.trim().replace(/\s+/g, ' ');
    const key = keyword.toLowerCase();
    if (!keyword || seen.has(key)) continue;
    seen.add(key);
    out.push(keyword);
  }
  return out;
}

interface AddKeywordsManuallyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (keywords: string[], intent: PlannerIntent) => Promise<void>;
}

export function AddKeywordsManuallyDialog({ open, onOpenChange, onSubmit }: AddKeywordsManuallyDialogProps) {
  const [text, setText] = useState('');
  const [intent, setIntent] = useState<PlannerIntent>('informational');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setText('');
  }, [open]);

  const keywords = useMemo(() => parseManualKeywords(text), [text]);
  const tooMany = keywords.length > MAX_MANUAL_KEYWORDS;

  const submit = async () => {
    if (!keywords.length || tooMany) return;
    setSubmitting(true);
    try {
      await onSubmit(keywords, intent);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add keywords or content ideas</DialogTitle>
          <DialogDescription>
            One per line (or comma separated). They go into Backlog so you can track them like any saved keyword.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Keywords or ideas</Label>
            <Textarea
              autoFocus
              rows={7}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'emergency plumber brisbane\nhow to fix a leaking tap\nbest water heaters 2026'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
              }}
            />
            <p className={`text-xs ${tooMany ? 'text-destructive' : 'text-muted-foreground'}`}>
              {tooMany
                ? `${keywords.length} entries. Add up to ${MAX_MANUAL_KEYWORDS} at a time.`
                : `${keywords.length} ${keywords.length === 1 ? 'entry' : 'entries'}`}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Intent</Label>
            <Select value={intent} onValueChange={(v) => setIntent(v as PlannerIntent)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTENT_ORDER.map((i) => (
                  <SelectItem key={i} value={i}>{INTENT_LABELS[i]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!keywords.length || tooMany || submitting}>
            {submitting ? 'Adding...' : keywords.length ? `Add ${keywords.length} to planner` : 'Add to planner'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

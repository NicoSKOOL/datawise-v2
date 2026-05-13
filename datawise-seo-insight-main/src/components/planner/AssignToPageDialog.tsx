import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

interface AssignToPageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  knownUrls: string[];
  onSubmit: (url: string | null) => void | Promise<void>;
}

const DATALIST_ID = 'planner-known-urls';

export function AssignToPageDialog({ open, onOpenChange, count, knownUrls, onSubmit }: AssignToPageDialogProps) {
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setUrl('');
  }, [open]);

  // Accept absolute (https://...) or root-relative (/services/foo) URLs.
  const trimmed = url.trim();
  const isValid = /^https?:\/\/\S+/.test(trimmed) || /^\/\S*/.test(trimmed);

  const submit = async (value: string | null) => {
    setSubmitting(true);
    try {
      await onSubmit(value);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign {count} keyword{count === 1 ? '' : 's'} to a page</DialogTitle>
          <DialogDescription>
            Point all selected keywords at one URL. Useful for grouping transactional terms onto an existing service or product page.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Page URL</Label>
            <Input
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/services/foo  or  /services/foo"
              list={DATALIST_ID}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isValid && !submitting) submit(trimmed);
              }}
            />
            <datalist id={DATALIST_ID}>
              {knownUrls.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            {!isValid && trimmed.length > 0 && (
              <p className="text-[11px] text-destructive">
                Enter an absolute URL (https://…) or a root-relative path (/path).
              </p>
            )}
          </div>

          <div className="flex justify-between gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => submit(null)}
              disabled={submitting}
            >
              Clear assignment
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={() => submit(trimmed)} disabled={!isValid || submitting}>
                {submitting ? 'Assigning…' : 'Assign'}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

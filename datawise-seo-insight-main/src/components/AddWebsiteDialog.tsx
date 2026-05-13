import { useEffect, useState } from 'react';
import { Loader2, Plus, Globe } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { createManualProperty } from '@/lib/gsc';
import { useProperty } from '@/contexts/PropertyContext';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddWebsiteDialog({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const { addProperty } = useProperty();
  const [domain, setDomain] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDomain('');
      setError(null);
    }
  }, [open]);

  async function submit() {
    const trimmed = domain.trim();
    if (!trimmed) {
      setError('Enter a domain.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const property = await createManualProperty(trimmed);
      addProperty(property);
      toast({
        title: 'Website added',
        description: 'Now selected. You can run keyword research, audits, and rank tracking on it.',
      });
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add website';
      if (/already_connected_via_gsc/i.test(msg)) {
        setError('This domain is already connected via Google Search Console.');
      } else if (/already_added/i.test(msg)) {
        setError('You have already added this website.');
      } else if (/Invalid domain/i.test(msg)) {
        setError('Invalid domain. Try something like example.com or https://example.com.');
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-primary" />
            Add a website
          </DialogTitle>
          <DialogDescription>
            Track a site that isn&apos;t connected to Google Search Console. Useful for sites you don&apos;t own yet, competitor research, or planning content for a brand-new domain.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="manual-domain" className="text-xs">Domain</Label>
            <Input
              id="manual-domain"
              autoFocus
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !submitting) submit(); }}
              placeholder="example.com"
              disabled={submitting}
            />
            <p className="text-[11px] text-muted-foreground">
              No GSC data will be synced for this site. Connect it via Settings → GSC later if you own it.
            </p>
          </div>
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-600">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting || !domain.trim()}>
            {submitting ? (
              <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Adding...</>
            ) : (
              <><Plus className="h-3.5 w-3.5 mr-1.5" /> Add website</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { Loader2, Plus, Globe } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { connectGSC, createManualProperty, type GSCProperty } from '@/lib/gsc';
import { useProperty } from '@/contexts/PropertyContext';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: 'choose' | 'manual';
  onAdded?: (property: GSCProperty) => void;
}

export function AddWebsiteDialog({ open, onOpenChange, initialMode = 'choose', onAdded }: Props) {
  const { toast } = useToast();
  const { addProperty } = useProperty();
  const [mode, setMode] = useState<'choose' | 'manual'>(initialMode);
  const [domain, setDomain] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setDomain('');
      setError(null);
    }
  }, [initialMode, open]);

  async function startGSCConnection() {
    setConnecting(true);
    setError(null);
    try {
      const data = await connectGSC();
      window.location.href = data.url;
    } catch {
      setConnecting(false);
      setError('Could not start the Google Search Console connection.');
    }
  }

  async function submit() {
    const trimmed = domain.trim();
    if (!trimmed) {
      setError('Enter a domain like example.com.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await createManualProperty(trimmed);
      addProperty(result.property);
      onAdded?.(result.property);

      if (result.connectedViaGsc) {
        toast({
          title: 'Website already connected through GSC',
          description: 'We selected it for you.',
        });
      } else if (result.duplicate) {
        toast({
          title: 'Website already exists',
          description: 'We selected it for you.',
        });
      } else {
        toast({
          title: 'Website added',
          description: 'Now selected for keyword research, content planning, audits, and rank tracking.',
        });
      }
      onOpenChange(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add website';
      if (/Invalid domain/i.test(msg)) {
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
            Add a site from Google Search Console, or add one without GSC for research and planning.
          </DialogDescription>
        </DialogHeader>

        {mode === 'choose' ? (
          <div className="space-y-3 py-2">
            <button
              type="button"
              onClick={startGSCConnection}
              disabled={connecting}
              className="w-full rounded-lg border border-emerald-200 bg-emerald-50/70 p-4 text-left transition-colors hover:bg-emerald-100/80 disabled:opacity-60 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/35"
            >
              <span className="block text-sm font-medium">
                {connecting ? 'Connecting...' : 'Connect Google Search Console'}
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Best for sites you own. Enables dashboard metrics, GSC queries, and syncing.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className="w-full rounded-lg border border-blue-200 bg-blue-50/70 p-4 text-left transition-colors hover:bg-blue-100/80 dark:border-blue-900/50 dark:bg-blue-950/20 dark:hover:bg-blue-950/35"
            >
              <span className="block text-sm font-medium">Add without GSC</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Use this for client, competitor, staging, or new sites. Works for keyword research, planner, audits, and rank tracking setup.
              </span>
            </button>
            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-600">
                {error}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
              Manual sites do not sync GSC metrics, but they can still be selected for keyword research, content planning, audits, and rank tracking setup.
            </div>
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
            </div>
            {error && (
              <div className="rounded-md border border-red-500/40 bg-red-500/5 p-2 text-xs text-red-600">
                {error}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2">
          {mode === 'manual' && initialMode === 'choose' && (
            <Button variant="ghost" onClick={() => setMode('choose')} disabled={submitting}>
              Back
            </Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting || connecting}>
            Cancel
          </Button>
          {mode === 'manual' && (
            <Button onClick={submit} disabled={submitting || !domain.trim()}>
              {submitting ? (
                <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Adding...</>
              ) : (
                <><Plus className="h-3.5 w-3.5 mr-1.5" /> Add without GSC</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

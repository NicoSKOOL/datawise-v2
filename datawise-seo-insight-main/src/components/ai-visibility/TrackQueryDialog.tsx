import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { fetchRankProjects } from '@/lib/dataforseo';
import { addAIQueries } from '@/lib/ai-tracking';
import type { Project } from '@/types/rank-tracking';

function cleanDomain(value: string): string {
  return value.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/^www\./, '').replace(/\/+$/, '').toLowerCase();
}

interface TrackQueryDialogProps {
  query: string | null;
  onOpenChange: (open: boolean) => void;
  // Preselects the project whose domain matches (e.g. the site picked in the
  // top site selector, or the domain Brand Tracker analyzed).
  defaultDomain?: string;
}

// Adds a one-off query to the weekly AI tracker. Shared by the Instant Check
// results row and the Brand Tracker answers table.
export default function TrackQueryDialog({ query, onOpenChange, defaultDomain }: TrackQueryDialogProps) {
  const open = !!query;
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    if (!open || projects !== null) return;
    fetchRankProjects()
      .then((list) => {
        const rows = (list as Project[]) || [];
        setProjects(rows);
        if (rows.length > 0) {
          const wanted = defaultDomain ? cleanDomain(defaultDomain) : null;
          const match = wanted ? rows.find(p => cleanDomain(p.domain) === wanted) : null;
          setProjectId((match ?? rows[0]).id);
        }
      })
      .catch(() => setProjects([]));
  }, [open, projects, defaultDomain]);

  const track = async () => {
    if (!projectId || !query) return;
    setSaving(true);
    try {
      const result = await addAIQueries(projectId, [{ text: query.trim(), source: 'custom' }]);
      if (result.added === 0 && result.remaining === 0) {
        toast({ title: 'Query limit reached', description: 'This project already tracks its maximum number of AI queries.', variant: 'destructive' });
      } else if (result.added === 0) {
        toast({ title: 'Already tracked', description: 'This query is already in that project.' });
      } else {
        toast({ title: 'Query tracked', description: 'It will be checked every Monday. Open the Performance tab to run a check now.' });
      }
      onOpenChange(false);
    } catch (err) {
      toast({
        title: 'Could not track query',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Track this query weekly</DialogTitle>
          <DialogDescription>
            "{query?.trim()}" will be checked every Monday across your enabled AI engines, and its history will appear in the Performance tab.
          </DialogDescription>
        </DialogHeader>

        {projects === null ? (
          <p className="py-2 text-sm text-muted-foreground">Loading projects…</p>
        ) : projects.length === 0 ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Tracking runs on a rank-tracking project. Create one with your domain first.
            </p>
            <Button variant="secondary" onClick={() => { onOpenChange(false); navigate('/rank-tracking?tab=tracked'); }}>
              Go to Rank Tracking
            </Button>
          </div>
        ) : (
          <div className="space-y-2 py-2">
            <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Project</Label>
            <Select value={projectId ?? undefined} onValueChange={setProjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map(project => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name} · {project.domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={track} disabled={saving || !projectId || (projects?.length ?? 0) === 0}>
            {saving ? 'Tracking…' : 'Track query'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { CalendarClock } from 'lucide-react';
import { fetchRankProjects } from '@/lib/dataforseo';
import { addAIQueries } from '@/lib/ai-tracking';
import type { Project } from '@/types/rank-tracking';

// Bridge from a one-off instant check to the persistent tracker: "this
// answer was interesting, watch it every week." Renders as a quiet row
// under the check results; the dialog picks which project tracks it.
export default function TrackQueryInline({ query }: { query: string }) {
  const [open, setOpen] = useState(false);
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
        if (rows.length > 0) setProjectId(rows[0].id);
      })
      .catch(() => setProjects([]));
  }, [open, projects]);

  const track = async () => {
    if (!projectId) return;
    setSaving(true);
    try {
      const result = await addAIQueries(projectId, [{ text: query.trim(), source: 'custom' }]);
      if (result.added === 0 && result.remaining === 0) {
        toast({ title: 'Query limit reached', description: 'This project already tracks its maximum number of AI queries.', variant: 'destructive' });
      } else if (result.added === 0) {
        toast({ title: 'Already tracked', description: 'This query is already in that project.' });
      } else {
        toast({ title: 'Query tracked', description: 'It will be checked every Monday. Run a check from the Performance tab to get data now.' });
      }
      setOpen(false);
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

  if (!query.trim()) return null;

  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border border-dashed px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CalendarClock className="h-4 w-4 flex-shrink-0" />
          <span>One-off checks are not saved. Track "{query.trim()}" weekly to build a trend in your Performance report.</span>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          Track weekly
        </Button>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Track this query weekly</DialogTitle>
            <DialogDescription>
              "{query.trim()}" will be checked every Monday across your enabled AI engines, and its history will appear in the Performance tab.
            </DialogDescription>
          </DialogHeader>

          {projects === null ? (
            <p className="py-2 text-sm text-muted-foreground">Loading projects…</p>
          ) : projects.length === 0 ? (
            <div className="space-y-3 py-2">
              <p className="text-sm text-muted-foreground">
                Tracking runs on a rank-tracking project. Create one with your domain first.
              </p>
              <Button variant="secondary" onClick={() => { setOpen(false); navigate('/rank-tracking?tab=tracked'); }}>
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
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={track} disabled={saving || !projectId || (projects?.length ?? 0) === 0}>
              {saving ? 'Tracking…' : 'Track query'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

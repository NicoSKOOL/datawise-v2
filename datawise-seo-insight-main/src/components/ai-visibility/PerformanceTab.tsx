import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, TrendingUp } from 'lucide-react';
import { fetchRankProjects, fetchProjectKeywords } from '@/lib/dataforseo';
import type { Project, TrackedKeyword } from '@/types/rank-tracking';
import AIVisibilityPanel from '@/components/rank-tracking/AIVisibilityPanel';

const LAST_PROJECT_KEY = 'datawise:ai-visibility:last-project';

// The Performance tab is the persistent AI-search report: pick a project,
// see the tracked score/trends/share-of-voice, manage tracked queries. It
// reuses the same panel as Rank Tracking so the two surfaces never drift.
export default function PerformanceTab() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      const list = await fetchRankProjects() as Project[];
      setProjects(list);
      if (list.length > 0) {
        const remembered = localStorage.getItem(LAST_PROJECT_KEY);
        const initial = list.find(p => p.id === remembered) ?? list[0];
        setSelectedId(initial.id);
      }
    } catch (err) {
      setProjects([]);
      toast({
        title: 'Could not load projects',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => projects?.find(p => p.id === selectedId) ?? null,
    [projects, selectedId],
  );

  // Tracked keywords feed the panel's "quick add from tracked keywords" chips.
  useEffect(() => {
    if (!selected) { setKeywords([]); return; }
    let cancelled = false;
    fetchProjectKeywords(selected.id)
      .then((rows) => {
        if (!cancelled) setKeywords(((rows as TrackedKeyword[]) || []).map(k => k.keyword));
      })
      .catch(() => { if (!cancelled) setKeywords([]); });
    return () => { cancelled = true; };
  }, [selected]);

  const selectProject = (id: string) => {
    setSelectedId(id);
    try { localStorage.setItem(LAST_PROJECT_KEY, id); } catch { /* private mode */ }
  };

  if (projects === null) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (projects.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <TrendingUp className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-semibold">Track how AI search answers cite your site</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              AI visibility tracking runs on a rank-tracking project. Create one with your domain, then come back here to add the queries you want checked every week.
            </p>
          </div>
          <Button asChild>
            <Link to="/rank-tracking?tab=tracked">Create a project in Rank Tracking</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Project</Label>
          <Select value={selectedId ?? undefined} onValueChange={selectProject}>
            <SelectTrigger className="w-72">
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
      </div>

      {selected && (
        <AIVisibilityPanel
          key={selected.id}
          project={{ id: selected.id, domain: selected.domain }}
          trackedKeywords={keywords}
        />
      )}
    </div>
  );
}

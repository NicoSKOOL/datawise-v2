import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { RefreshCw, Sparkles, TrendingUp } from 'lucide-react';
import { useProperty } from '@/contexts/PropertyContext';
import { fetchRankProjects, createRankProject, fetchProjectKeywords } from '@/lib/dataforseo';
import { cleanTrackingDomain as cleanDomain, rankProjectsForAITracking } from '@/lib/ai-tracking';
import type { Project, TrackedKeyword } from '@/types/rank-tracking';
import AIVisibilityPanel from '@/components/rank-tracking/AIVisibilityPanel';

// The Performance tab is the persistent AI-search report for the site picked
// in the top site selector: same site everywhere in the app. Tracking data
// lives on the rank-tracking project whose domain matches that site; if none
// exists yet, one click creates it.
export default function PerformanceTab() {
  const { selectedProperty, primaryDomain } = useProperty();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [chosenProjectId, setChosenProjectId] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      setProjects(await fetchRankProjects() as Project[]);
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

  // All projects on this domain, best AI-tracking candidate first. Several
  // projects can share a domain (duplicates happen); picking the newest by
  // accident showed the wrong report, so rank and let the user switch.
  const domainProjects = useMemo(() => {
    if (!projects || !primaryDomain) return [];
    const wanted = cleanDomain(primaryDomain);
    return rankProjectsForAITracking(projects.filter(p => cleanDomain(p.domain) === wanted));
  }, [projects, primaryDomain]);

  const project = useMemo(() => {
    if (!domainProjects.length) return null;
    return domainProjects.find(p => p.id === chosenProjectId) ?? domainProjects[0];
  }, [domainProjects, chosenProjectId]);

  // Tracked keywords feed the panel's "quick add from tracked keywords" chips.
  useEffect(() => {
    if (!project) { setKeywords([]); return; }
    let cancelled = false;
    fetchProjectKeywords(project.id)
      .then((rows) => {
        if (!cancelled) setKeywords(((rows as TrackedKeyword[]) || []).map(k => k.keyword));
      })
      .catch(() => { if (!cancelled) setKeywords([]); });
    return () => { cancelled = true; };
  }, [project]);

  const setUpTracking = async () => {
    if (!primaryDomain) return;
    setCreating(true);
    try {
      await createRankProject({ name: primaryDomain, domain: primaryDomain });
      await load();
      toast({ title: 'Tracking project created', description: `AI visibility tracking is ready for ${primaryDomain}. Add the queries you want checked weekly.` });
    } catch (err) {
      toast({
        title: 'Could not create the project',
        description: err instanceof Error ? err.message : 'Try again in a moment.',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  if (!selectedProperty) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <TrendingUp className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-semibold">Pick a website to see its AI search performance</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Use the site selector at the top of the sidebar. This report follows whichever website is selected there.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (projects === null) {
    return (
      <Card>
        <CardContent className="flex justify-center py-10">
          <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!project) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Sparkles className="h-8 w-8 text-muted-foreground" />
          <div>
            <p className="font-semibold">Start tracking AI search visibility for {primaryDomain}</p>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              One click sets up the tracking project. Then add the queries you care about, and they are checked every Monday across Google AI Mode, ChatGPT, and Perplexity.
            </p>
          </div>
          <Button onClick={setUpTracking} disabled={creating}>
            {creating ? 'Setting up…' : `Set up AI tracking for ${primaryDomain}`}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Weekly checks of your tracked queries for <span className="font-medium text-foreground">{project.domain}</span> across Google AI Mode, ChatGPT, and Perplexity: are you cited for the queries you care about, and is it trending up? Discover new queries worth tracking in the Brand Tracker tab.
      </p>
      {domainProjects.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>{domainProjects.length} tracking projects use this domain. Showing:</span>
          <Select value={project.id} onValueChange={setChosenProjectId}>
            <SelectTrigger className="h-8 w-auto min-w-44 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {domainProjects.map(p => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <AIVisibilityPanel
        key={project.id}
        project={{ id: project.id, domain: project.domain }}
        trackedKeywords={keywords}
      />
    </div>
  );
}

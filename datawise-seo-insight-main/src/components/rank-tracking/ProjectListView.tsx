import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Plus, Trash2, Globe, Target, ChevronUp, ChevronDown, Minus } from 'lucide-react';
import { locationOptions } from '@/lib/dataForSeoLocations';
import { useDefaults } from '@/hooks/use-defaults';
import type { Project } from '@/types/rank-tracking';

interface ProjectListViewProps {
  projects: Project[];
  loading: boolean;
  selectedDomain?: string;
  onSelect: (project: Project) => void;
  onDelete: (projectId: string) => void;
  onCreate: (name: string, domain: string, locationCode: number) => Promise<void>;
}

function domainsMatch(a: string, b: string): boolean {
  const clean = (d: string) => d.replace(/^(sc-domain:|https?:\/\/)/, '').replace(/^www\./, '').replace(/\/+$/, '').split('/')[0].toLowerCase();
  const ca = clean(a);
  const cb = clean(b);
  if (!ca || !cb) return false;
  return ca === cb || ca.endsWith(`.${cb}`) || cb.endsWith(`.${ca}`);
}

function formatLastChecked(value: string | null | undefined) {
  if (!value) return 'Never checked';
  const checked = new Date(`${value.replace(' ', 'T')}Z`);
  const days = Math.floor((Date.now() - checked.getTime()) / 86400000);
  if (days <= 0) return 'Checked today';
  if (days === 1) return 'Checked yesterday';
  return `Checked ${days} days ago`;
}

export default function ProjectListView({ projects, loading, selectedDomain, onSelect, onDelete, onCreate }: ProjectListViewProps) {
  // The country a project is created with decides which Google every ranking
  // check runs against, so it must start from the user's saved default rather
  // than a hardcoded country they never chose.
  const { defaultLocation } = useDefaults();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [locationCode, setLocationCode] = useState(defaultLocation);
  const [showAllSites, setShowAllSites] = useState(false);

  // Scope the list to the sidebar-selected website by default. Other sites'
  // projects stay one click away instead of drowning the list.
  const matching = selectedDomain ? projects.filter((p) => p.domain && domainsMatch(p.domain, selectedDomain)) : projects;
  const hiddenCount = projects.length - matching.length;
  const scoped = showAllSites || !selectedDomain || matching.length === 0 ? projects : matching;

  const handleCreate = async () => {
    if (!name.trim() || !domain.trim()) return;
    await onCreate(name.trim(), domain.trim(), parseInt(locationCode, 10));
    setName('');
    setDomain('');
    setLocationCode(defaultLocation);
    setCreateOpen(false);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Tracked Keyword Projects</h2>
          <p className="text-sm text-muted-foreground">Create a watchlist, then run exact ranking checks over time.</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              New Project
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Rank Tracking Project</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <Label htmlFor="project-name">Project Name</Label>
                <Input
                  id="project-name"
                  placeholder="e.g., Main Site"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="project-domain">Domain</Label>
                <Input
                  id="project-domain"
                  placeholder="e.g., example.com"
                  value={domain}
                  onChange={(event) => setDomain(event.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Country</Label>
                <Select value={locationCode} onValueChange={setLocationCode}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select country" />
                  </SelectTrigger>
                  <SelectContent className="bg-popover border z-50 max-h-[200px]">
                    {locationOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value.toString()}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
              <Button onClick={handleCreate} disabled={!name.trim() || !domain.trim()}>
                Create Project
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {selectedDomain && matching.length > 0 && hiddenCount > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>
            {showAllSites
              ? `Showing all ${projects.length} projects across your sites.`
              : `Showing projects for ${selectedDomain}.`}
          </span>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setShowAllSites((v) => !v)}>
            {showAllSites ? `Only ${selectedDomain}` : `Show all sites (${hiddenCount} more)`}
          </Button>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2"><Skeleton className="h-6 w-2/3" /></CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : scoped.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[360px] rounded-xl border-2 border-dashed">
          <Target className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground">No projects yet</h3>
          <p className="text-sm text-muted-foreground/60 mt-1 mb-4 text-center max-w-md">
            Create a project to monitor exact keyword positions. You can also import promising queries from the GSC tab once a project exists.
          </p>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Your First Project
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {scoped.map((project) => {
            const checkedRecently = project.last_checked_at
              ? (Date.now() - new Date(`${project.last_checked_at.replace(' ', 'T')}Z`).getTime()) < 8 * 86400000
              : false;
            return (
              <Card
                key={project.id}
                className="cursor-pointer hover:border-primary/50 transition-colors group"
                onClick={() => onSelect(project)}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <CardTitle className="text-lg">{project.name}</CardTitle>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(event) => { event.stopPropagation(); onDelete(project.id); }}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 mb-3">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="secondary">{project.domain}</Badge>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {project.keyword_count} keyword{project.keyword_count !== 1 ? 's' : ''}
                    </span>
                    {project.keyword_count > 0 && (
                      <span className="text-muted-foreground">
                        {project.avg_position != null ? (
                          <>
                            Avg pos <span className="font-semibold text-foreground">{project.avg_position}</span>
                            {' '}({project.ranking_keywords ?? 0} ranking)
                          </>
                        ) : (
                          'No ranks yet'
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-2 text-xs">
                    {project.last_checked_at == null ? (
                      <Minus className="h-3 w-3 text-muted-foreground" />
                    ) : checkedRecently ? (
                      <ChevronUp className="h-3 w-3 text-green-600" />
                    ) : (
                      <ChevronDown className="h-3 w-3 text-amber-500" />
                    )}
                    <span className={project.last_checked_at && !checkedRecently ? 'text-amber-600' : 'text-muted-foreground'}>
                      {formatLastChecked(project.last_checked_at)}
                    </span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

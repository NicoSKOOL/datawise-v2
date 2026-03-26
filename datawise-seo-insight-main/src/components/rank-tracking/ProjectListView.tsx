import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { Plus, RefreshCw, Trash2, Globe, Target } from 'lucide-react';
import { locationOptions } from '@/lib/dataForSeoLocations';
import type { Project } from '@/types/rank-tracking';

interface ProjectListViewProps {
  projects: Project[];
  loading: boolean;
  onSelect: (project: Project) => void;
  onDelete: (projectId: string) => void;
  onCreate: (name: string, domain: string, locationCode: number) => Promise<void>;
}

export default function ProjectListView({ projects, loading, onSelect, onDelete, onCreate }: ProjectListViewProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [locationCode, setLocationCode] = useState('2036');

  const handleCreate = async () => {
    if (!name.trim() || !domain.trim()) return;
    await onCreate(name.trim(), domain.trim(), parseInt(locationCode, 10));
    setName('');
    setDomain('');
    setLocationCode('2036');
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

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : projects.length === 0 ? (
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
          {projects.map((project) => (
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
                <div className="flex items-center gap-2 mb-2">
                  <Globe className="h-4 w-4 text-muted-foreground" />
                  <Badge variant="secondary">{project.domain}</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {project.keyword_count} keyword{project.keyword_count !== 1 ? 's' : ''} tracked
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

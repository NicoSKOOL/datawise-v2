import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, Trash2, MapPin, Star, Target } from 'lucide-react';
import CreateLocalProjectDialog from './CreateLocalProjectDialog';
import type { LocalProject } from '@/types/local-seo';

interface LocalProjectListViewProps {
  projects: LocalProject[];
  loading: boolean;
  onSelect: (project: LocalProject) => void;
  onDelete: (projectId: string) => void;
  onCreate: (params: {
    name: string;
    business_name: string;
    place_id?: string;
    cid?: string;
    domain?: string;
  }) => Promise<void>;
}

export default function LocalProjectListView({ projects, loading, onSelect, onDelete, onCreate }: LocalProjectListViewProps) {
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Local Pack Projects</h2>
          <p className="text-sm text-muted-foreground">Track your business position in Google Maps and local pack results.</p>
        </div>
        <CreateLocalProjectDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreate={onCreate}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[360px] rounded-xl border-2 border-dashed">
          <Target className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground">No local projects yet</h3>
          <p className="text-sm text-muted-foreground/60 mt-1 mb-4 text-center max-w-md">
            Create a project to monitor your business position in Google's local pack. Search for your business to get started.
          </p>
          <Button onClick={() => setCreateOpen(true)}>
            <MapPin className="h-4 w-4 mr-2" />
            Create Your First Local Project
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
                    onClick={(e) => { e.stopPropagation(); onDelete(project.id); }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {project.business_name && (
                  <div className="flex items-center gap-2 mb-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <Badge variant="secondary">{project.business_name}</Badge>
                  </div>
                )}
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

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Plus, RefreshCw, Globe } from 'lucide-react';
import type { Project } from '@/types/rank-tracking';

interface ProjectDetailHeaderProps {
  project: Project;
  checking: boolean;
  keywordCount: number;
  onBack: () => void;
  onAddKeywords: () => void;
  onCheckRankings: () => void;
}

export default function ProjectDetailHeader({
  project, checking, keywordCount, onBack, onAddKeywords, onCheckRankings,
}: ProjectDetailHeaderProps) {
  return (
    <div className="flex items-center justify-between flex-wrap gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          <Badge variant="secondary" className="mt-1">
            <Globe className="h-3 w-3 mr-1" />
            {project.domain}
          </Badge>
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onAddKeywords}>
          <Plus className="h-4 w-4 mr-2" />
          Add Keywords
        </Button>
        <Button onClick={onCheckRankings} disabled={checking || keywordCount === 0}>
          <RefreshCw className={`h-4 w-4 mr-2 ${checking ? 'animate-spin' : ''}`} />
          {checking ? 'Checking...' : 'Check Rankings'}
        </Button>
      </div>
    </div>
  );
}

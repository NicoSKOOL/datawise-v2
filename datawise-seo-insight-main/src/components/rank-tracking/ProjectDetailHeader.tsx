import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Plus, RefreshCw, Globe, MapPin } from 'lucide-react';
import { locationOptions } from '@/lib/dataForSeoLocations';
import type { Project } from '@/types/rank-tracking';

const locationLabelByCode = new Map(locationOptions.map((o) => [o.value, o.label]));

interface ProjectDetailHeaderProps {
  project: Project;
  checking: boolean;
  keywordCount: number;
  onBack: () => void;
  onAddKeywords: () => void;
  onCheckRankings: () => void;
  onEditLocale?: () => void;
  extraActions?: ReactNode;
}

export default function ProjectDetailHeader({
  project, checking, keywordCount, onBack, onAddKeywords, onCheckRankings, onEditLocale, extraActions,
}: ProjectDetailHeaderProps) {
  const countryLabel = project.location_code
    ? locationLabelByCode.get(project.location_code) || `Location ${project.location_code}`
    : null;

  return (
    <div className="flex items-center justify-between flex-wrap gap-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary">
              <Globe className="h-3 w-3 mr-1" />
              {project.domain}
            </Badge>
            {/* Which Google these rankings come from, and a way to correct it. */}
            {countryLabel && (
              onEditLocale ? (
                <button
                  type="button"
                  onClick={onEditLocale}
                  title="Change the country these rankings are checked in"
                  className="inline-flex items-center rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-solid transition-colors"
                >
                  <MapPin className="h-3 w-3 mr-1" />
                  {countryLabel}
                </button>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  <MapPin className="h-3 w-3 mr-1" />
                  {countryLabel}
                </Badge>
              )
            )}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        {extraActions}
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

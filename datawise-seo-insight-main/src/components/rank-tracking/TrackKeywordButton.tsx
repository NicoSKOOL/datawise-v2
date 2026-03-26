import { useState, useRef, useEffect } from 'react';
import { Plus, Check, ChevronDown, RefreshCw } from 'lucide-react';
import type { Project } from '@/types/rank-tracking';

interface TrackKeywordButtonProps {
  keyword: string;
  position?: number;
  projects: Project[];
  onTrack: (keyword: string, projectId: string, position?: number) => Promise<void>;
  disabled?: boolean;
  isTracked?: boolean;
}

export default function TrackKeywordButton({ keyword, position, projects, onTrack, disabled, isTracked }: TrackKeywordButtonProps) {
  const [open, setOpen] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [tracked, setTracked] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleSelect = async (projectId: string) => {
    setTracking(true);
    setOpen(false);
    try {
      await onTrack(keyword, projectId, position);
      setTracked(true);
    } finally {
      setTracking(false);
    }
  };

  if (projects.length === 0 || disabled) {
    return (
      <span className="text-xs text-muted-foreground cursor-not-allowed">
        {projects.length === 0 ? 'No projects' : 'Track'}
      </span>
    );
  }

  if (tracking) {
    return <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
  }

  if (tracked || isTracked) {
    return <Check className="h-3.5 w-3.5 text-green-500" />;
  }

  // If only one project, track directly
  if (projects.length === 1) {
    return (
      <button
        className="text-xs font-bold text-primary hover:underline transition-colors inline-flex items-center gap-1"
        onClick={() => handleSelect(projects[0].id)}
      >
        <Plus className="h-3 w-3" />
        Track
      </button>
    );
  }

  // Multiple projects: show popover
  return (
    <div className="relative" ref={popoverRef}>
      <button
        className="text-xs font-bold text-primary hover:underline transition-colors inline-flex items-center gap-0.5"
        onClick={() => setOpen(!open)}
      >
        <Plus className="h-3 w-3" />
        Track
        <ChevronDown className="h-3 w-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-white rounded-lg shadow-lg border border-border/60 py-1 min-w-[200px] max-w-[280px]">
          <p className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Add to project
          </p>
          {projects.map((project) => (
            <button
              key={project.id}
              className="w-full text-left px-3 py-2 text-sm hover:bg-secondary/60 transition-colors flex items-center justify-between gap-2"
              onClick={() => handleSelect(project.id)}
            >
              <span className="truncate font-medium">{project.name}</span>
              <span className="text-[10px] text-muted-foreground shrink-0">{project.domain}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

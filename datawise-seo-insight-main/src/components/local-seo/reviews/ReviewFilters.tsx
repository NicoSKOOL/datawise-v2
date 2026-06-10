import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Star, X } from 'lucide-react';

export type RatingFilter = 'all' | '5' | '4' | 'low';
export type ResponseFilter = 'all' | 'responded' | 'unanswered';
export type SortOrder = 'newest' | 'oldest' | 'lowest';

export interface ReviewFilterState {
  rating: RatingFilter;
  response: ResponseFilter;
  themeIndex: number | null;
  sort: SortOrder;
}

export const DEFAULT_FILTERS: ReviewFilterState = { rating: 'all', response: 'all', themeIndex: null, sort: 'newest' };

interface ReviewFiltersProps {
  filters: ReviewFilterState;
  activeThemeName: string | null;
  onChange: (filters: ReviewFilterState) => void;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-0.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${
        active
          ? 'bg-[#005232] text-white border-[#005232]'
          : 'bg-white hover:bg-muted text-muted-foreground border-border'
      }`}
    >
      {children}
    </button>
  );
}

export default function ReviewFilters({ filters, activeThemeName, onChange }: ReviewFiltersProps) {
  const hasActive = filters.rating !== 'all' || filters.response !== 'all' || filters.themeIndex != null || filters.sort !== 'newest';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1">
        <Chip active={filters.rating === 'all'} onClick={() => onChange({ ...filters, rating: 'all' })}>All ratings</Chip>
        <Chip active={filters.rating === '5'} onClick={() => onChange({ ...filters, rating: '5' })}>
          5<Star className="h-2.5 w-2.5 fill-current" />
        </Chip>
        <Chip active={filters.rating === '4'} onClick={() => onChange({ ...filters, rating: '4' })}>
          4<Star className="h-2.5 w-2.5 fill-current" />
        </Chip>
        <Chip active={filters.rating === 'low'} onClick={() => onChange({ ...filters, rating: 'low' })}>3 and below</Chip>
      </div>

      <div className="h-4 w-px bg-border" />

      <div className="flex items-center gap-1">
        <Chip active={filters.response === 'all'} onClick={() => onChange({ ...filters, response: 'all' })}>All</Chip>
        <Chip active={filters.response === 'responded'} onClick={() => onChange({ ...filters, response: 'responded' })}>Responded</Chip>
        <Chip active={filters.response === 'unanswered'} onClick={() => onChange({ ...filters, response: 'unanswered' })}>Unanswered</Chip>
      </div>

      {activeThemeName && (
        <button
          onClick={() => onChange({ ...filters, themeIndex: null })}
          className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-[#005232]/10 text-[#005232] border border-[#005232]/30"
        >
          Theme: {activeThemeName}
          <X className="h-3 w-3" />
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        <Select value={filters.sort} onValueChange={(v) => onChange({ ...filters, sort: v as SortOrder })}>
          <SelectTrigger className="h-7 w-[150px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="newest">Newest first</SelectItem>
            <SelectItem value="oldest">Oldest first</SelectItem>
            <SelectItem value="lowest">Lowest rating first</SelectItem>
          </SelectContent>
        </Select>
        {hasActive && (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange({ ...DEFAULT_FILTERS })}>
            <X className="h-3 w-3 mr-1" />Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

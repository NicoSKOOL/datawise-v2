import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { Link2, ChevronDown, Copy, X } from 'lucide-react';
import {
  STATUS_LABELS, STATUS_ORDER,
  type PlannerKeyword, type PlannerStatus,
} from '@/lib/planner';
import { copyText } from '@/lib/clipboard';
import { keywordsToList, keywordsToCsv } from '@/lib/planner-export';

interface BulkActionBarProps {
  selectedItems: PlannerKeyword[];
  onAssign: () => void;
  onSetStatus: (status: PlannerStatus) => void;
  onClear: () => void;
}

export function BulkActionBar({ selectedItems, onAssign, onSetStatus, onClear }: BulkActionBarProps) {
  const count = selectedItems.length;
  if (count === 0) return null;

  const handleCopy = async (mode: 'list' | 'csv') => {
    const text = mode === 'list' ? keywordsToList(selectedItems) : keywordsToCsv(selectedItems);
    const ok = await copyText(text);
    if (ok) toast.success(`Copied ${count} keyword${count === 1 ? '' : 's'}`);
    else toast.error('Copy failed — check clipboard permissions');
  };

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-lg border bg-card shadow-lg px-3 py-2">
      <span className="text-sm font-medium pr-1">
        {count} selected
      </span>

      <Button size="sm" onClick={onAssign}>
        <Link2 className="h-3.5 w-3.5 mr-1.5" /> Assign to page
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            Set status <ChevronDown className="h-3.5 w-3.5 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuLabel className="text-xs">Move to status</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {STATUS_ORDER.map((s) => (
            <DropdownMenuItem key={s} onClick={() => onSetStatus(s)}>
              {STATUS_LABELS[s]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline">
            <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy <ChevronDown className="h-3.5 w-3.5 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center">
          <DropdownMenuItem onClick={() => handleCopy('list')}>
            Copy keywords (one per line)
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleCopy('csv')}>
            Copy as CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button size="sm" variant="ghost" onClick={onClear} aria-label="Clear selection">
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

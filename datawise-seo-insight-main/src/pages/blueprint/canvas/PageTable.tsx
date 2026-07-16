import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BlueprintGraphNode } from './types';
import { recommendationClassName } from './badges';

const compactVolume = new Intl.NumberFormat('en', { notation: 'compact' });

type SortKey = 'title' | 'slug' | 'pageType' | 'primaryKeyword' | 'primaryVolume' | 'recommendation' | 'supportingKeywordCount';
type SortDir = 'asc' | 'desc';

interface SortState {
  key: SortKey;
  dir: SortDir;
}

const DEFAULT_SORT: SortState = { key: 'primaryVolume', dir: 'desc' };

const COLUMNS: { key: SortKey; label: string; align?: 'right' }[] = [
  { key: 'title', label: 'Title' },
  { key: 'slug', label: 'Slug' },
  { key: 'pageType', label: 'Type' },
  { key: 'primaryKeyword', label: 'Primary keyword' },
  { key: 'primaryVolume', label: 'Volume', align: 'right' },
  { key: 'recommendation', label: 'Recommendation' },
  { key: 'supportingKeywordCount', label: 'Supporting keywords', align: 'right' },
];

function compareValues(a: BlueprintGraphNode, b: BlueprintGraphNode, key: SortKey): number {
  const av = a[key];
  const bv = b[key];

  // Nulls (and empty strings for optional text fields) always sort last, regardless of direction.
  const aNull = av === null || av === undefined || av === '';
  const bNull = bv === null || bv === undefined || bv === '';
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  if (typeof av === 'number' && typeof bv === 'number') {
    return av - bv;
  }
  return String(av).localeCompare(String(bv));
}

function sortNodes(nodes: BlueprintGraphNode[], sort: SortState): BlueprintGraphNode[] {
  const dirMultiplier = sort.dir === 'asc' ? 1 : -1;
  return [...nodes].sort((a, b) => {
    const primary = compareValues(a, b, sort.key);
    if (primary !== 0) {
      // Nulls-last ordering from compareValues is direction-independent, so only
      // flip the sign when neither side is null (i.e. a real comparison happened).
      const aNull = a[sort.key] === null || a[sort.key] === undefined || a[sort.key] === '';
      const bNull = b[sort.key] === null || b[sort.key] === undefined || b[sort.key] === '';
      if (aNull || bNull) return primary;
      return primary * dirMultiplier;
    }
    return a.slug.localeCompare(b.slug);
  });
}

function matchesFilter(node: BlueprintGraphNode, needle: string): boolean {
  if (!needle) return true;
  const haystack = [node.title, node.slug, node.primaryKeyword ?? ''].join(' ').toLowerCase();
  return haystack.includes(needle);
}

export function PageTable(props: {
  nodes: BlueprintGraphNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { nodes, selectedId, onSelect } = props;
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);

  const visibleNodes = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = nodes.filter((node) => matchesFilter(node, needle));
    return sortNodes(filtered, sort);
  }, [nodes, filter, sort]);

  function handleHeaderClick(key: SortKey) {
    setSort((current) => {
      if (current.key === key) {
        return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
      }
      return { key, dir: 'desc' };
    });
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <Input
        placeholder="Filter by title, slug, or keyword..."
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
        className="max-w-sm"
      />
      <div className="overflow-auto rounded-md border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((column) => {
                const isActive = sort.key === column.key;
                const SortIcon = isActive ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
                return (
                  <TableHead
                    key={column.key}
                    className={cn('cursor-pointer select-none', column.align === 'right' && 'text-right')}
                    onClick={() => handleHeaderClick(column.key)}
                  >
                    <span className={cn('inline-flex items-center gap-1', column.align === 'right' && 'flex-row-reverse')}>
                      {column.label}
                      <SortIcon className={cn('h-3 w-3', isActive ? 'opacity-100' : 'opacity-40')} />
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleNodes.map((node) => (
              <TableRow
                key={node.logicalPageId}
                onClick={() => onSelect(node.logicalPageId)}
                className={cn('cursor-pointer', node.logicalPageId === selectedId && 'bg-emerald-50')}
              >
                <TableCell className="max-w-[240px] truncate font-medium" title={node.title}>
                  {node.title}
                </TableCell>
                <TableCell className="max-w-[180px] truncate font-mono text-xs text-muted-foreground" title={node.slug}>
                  {node.slug}
                </TableCell>
                <TableCell>{node.pageType}</TableCell>
                <TableCell className="max-w-[200px] truncate" title={node.primaryKeyword ?? undefined}>
                  {node.primaryKeyword ?? <span className="text-muted-foreground">-</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {node.primaryVolume !== null ? (
                    compactVolume.format(node.primaryVolume)
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge className={cn('border-transparent', recommendationClassName(node.recommendation))}>
                    {node.recommendation}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">{node.supportingKeywordCount}</TableCell>
              </TableRow>
            ))}
            {visibleNodes.length === 0 && (
              <TableRow>
                <TableCell colSpan={COLUMNS.length} className="h-24 text-center text-muted-foreground">
                  No pages match this filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

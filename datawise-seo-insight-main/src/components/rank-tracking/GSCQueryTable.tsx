import { Fragment, useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, ArrowUpDown, ArrowUp, ArrowDown, ChevronDown, ChevronRight } from 'lucide-react';
import type { GSCResultRow, GSCQuerySort } from '@/lib/gsc';
import type { Project } from '@/types/rank-tracking';
import TrackKeywordButton from './TrackKeywordButton';

interface SortConfig {
  column: GSCQuerySort;
  order: 'asc' | 'desc';
}

interface GSCQueryTableProps {
  rows: GSCResultRow[];
  mode: 'queries' | 'pages';
  loading: boolean;
  sort: SortConfig;
  onSort: (column: GSCQuerySort) => void;
  onTrack: (keyword: string, projectId: string, position?: number) => Promise<void>;
  projects: Project[];
  total: number;
  offset: number;
  limit: number;
  onLoadMore: () => void;
  trackedKeywords?: Set<string>;
  onLoadPageQueries?: (page: string) => Promise<GSCResultRow[]>;
}

function formatPercent(value: number | null | undefined, multiplier = 1) {
  if (value == null) return '--';
  return `${(value * multiplier).toFixed(1)}%`;
}

function stripOrigin(url: string) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function SortIcon({ column, sort }: { column: GSCQuerySort; sort: SortConfig }) {
  if (sort.column !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-30" />;
  return sort.order === 'asc'
    ? <ArrowUp className="h-3 w-3 ml-1 text-primary" />
    : <ArrowDown className="h-3 w-3 ml-1 text-primary" />;
}

export default function GSCQueryTable({
  rows, mode, loading, sort, onSort, onTrack, projects,
  total, offset, limit, onLoadMore, trackedKeywords, onLoadPageQueries,
}: GSCQueryTableProps) {
  const [expandedPage, setExpandedPage] = useState<string | null>(null);
  const [pageQueries, setPageQueries] = useState<Record<string, GSCResultRow[]>>({});
  const [loadingPage, setLoadingPage] = useState<string | null>(null);

  const togglePage = async (page: string) => {
    if (!onLoadPageQueries) return;
    if (expandedPage === page) {
      setExpandedPage(null);
      return;
    }
    setExpandedPage(page);
    if (pageQueries[page]) return;
    setLoadingPage(page);
    try {
      const queries = await onLoadPageQueries(page);
      setPageQueries((prev) => ({ ...prev, [page]: queries }));
    } catch (err) {
      console.error('Page queries fetch failed:', err);
      setExpandedPage(null);
    } finally {
      setLoadingPage(null);
    }
  };

  if (loading && rows.length === 0) {
    return (
      <div className="flex justify-center py-20">
        <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!loading && rows.length === 0) {
    return (
      <div className="text-center py-16 text-sm text-muted-foreground">
        No {mode === 'pages' ? 'pages' : 'queries'} match the current filter.
      </div>
    );
  }

  const hasMore = offset + limit < total;
  const isPages = mode === 'pages';

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-secondary/30">
              <th className="px-8 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                {isPages ? 'Page' : 'Keyword'}
              </th>
              {isPages && (
                <th className="px-8 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                  Queries
                </th>
              )}
              <th className="px-8 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                <button className="inline-flex items-center hover:text-foreground transition-colors" onClick={() => onSort('clicks')}>
                  Clicks <SortIcon column="clicks" sort={sort} />
                </button>
              </th>
              <th className="px-8 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                <button className="inline-flex items-center hover:text-foreground transition-colors" onClick={() => onSort('impressions')}>
                  Impressions <SortIcon column="impressions" sort={sort} />
                </button>
              </th>
              <th className="px-8 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                <button className="inline-flex items-center hover:text-foreground transition-colors" onClick={() => onSort('avg_ctr')}>
                  CTR <SortIcon column="avg_ctr" sort={sort} />
                </button>
              </th>
              <th className="px-8 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest">
                <button className="inline-flex items-center hover:text-foreground transition-colors" onClick={() => onSort('avg_position')}>
                  Position <SortIcon column="avg_position" sort={sort} />
                </button>
              </th>
              {!isPages && <th className="px-8 py-4 text-xs font-bold text-muted-foreground uppercase tracking-widest text-right"></th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-muted/50">
            {rows.map((row, i) => {
              const label = isPages ? (row.page || '') : (row.query || '');
              const expandable = isPages && !!onLoadPageQueries;
              const isExpanded = expandable && expandedPage === label;
              return (
                <Fragment key={label || i}>
                  <tr
                    className={`hover:bg-secondary/40 transition-colors ${expandable ? 'cursor-pointer' : ''}`}
                    onClick={expandable ? () => togglePage(label) : undefined}
                  >
                    <td className="px-8 py-5 max-w-[400px]">
                      <div className="flex items-start gap-2">
                        {expandable && (
                          <span className="mt-0.5 text-muted-foreground flex-shrink-0">
                            {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="font-bold text-sm truncate" title={label}>
                            {isPages ? stripOrigin(label) : label}
                          </p>
                          {isPages && (
                            <p className="text-xs text-muted-foreground truncate mt-0.5" title={label}>{label}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    {isPages && (
                      <td className="px-8 py-5 text-sm font-semibold text-muted-foreground tabular-nums">{row.query_count ?? '--'}</td>
                    )}
                    <td className="px-8 py-5">
                      <span className="font-headline font-extrabold text-lg tabular-nums">{row.clicks.toLocaleString()}</span>
                    </td>
                    <td className="px-8 py-5 text-sm font-semibold text-muted-foreground tabular-nums">{row.impressions.toLocaleString()}</td>
                    <td className="px-8 py-5 text-sm font-semibold text-muted-foreground tabular-nums">{formatPercent(row.avg_ctr, 100)}</td>
                    <td className="px-8 py-5">
                      <span className="font-headline font-extrabold text-lg tabular-nums">{row.avg_position}</span>
                    </td>
                    {!isPages && (
                      <td className="px-8 py-5 text-right">
                        <TrackKeywordButton
                          keyword={row.query || ''}
                          position={row.avg_position}
                          projects={projects}
                          onTrack={onTrack}
                          isTracked={trackedKeywords?.has(row.query || '')}
                        />
                      </td>
                    )}
                  </tr>
                  {isExpanded && (
                    <tr className="bg-secondary/20">
                      <td colSpan={6} className="px-8 py-4">
                        {loadingPage === label ? (
                          <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                            <RefreshCw className="h-4 w-4 animate-spin" />
                            Loading queries...
                          </div>
                        ) : (pageQueries[label] || []).length === 0 ? (
                          <p className="py-3 text-sm text-muted-foreground">No queries found for this page.</p>
                        ) : (
                          <table className="w-full text-left">
                            <thead>
                              <tr className="text-xs font-bold text-muted-foreground uppercase tracking-widest">
                                <th className="py-2 pr-4">Keyword</th>
                                <th className="py-2 pr-4">Clicks</th>
                                <th className="py-2 pr-4">Impressions</th>
                                <th className="py-2 pr-4">CTR</th>
                                <th className="py-2 pr-4">Position</th>
                                <th className="py-2 text-right"></th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-muted/30">
                              {(pageQueries[label] || []).map((q, qi) => (
                                <tr key={q.query || qi}>
                                  <td className="py-2.5 pr-4 text-sm font-semibold max-w-[360px] truncate" title={q.query}>{q.query}</td>
                                  <td className="py-2.5 pr-4 text-sm tabular-nums">{q.clicks.toLocaleString()}</td>
                                  <td className="py-2.5 pr-4 text-sm text-muted-foreground tabular-nums">{q.impressions.toLocaleString()}</td>
                                  <td className="py-2.5 pr-4 text-sm text-muted-foreground tabular-nums">{formatPercent(q.avg_ctr, 100)}</td>
                                  <td className="py-2.5 pr-4 text-sm font-bold tabular-nums">{q.avg_position}</td>
                                  <td className="py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                                    <TrackKeywordButton
                                      keyword={q.query || ''}
                                      position={q.avg_position}
                                      projects={projects}
                                      onTrack={onTrack}
                                      isTracked={trackedKeywords?.has(q.query || '')}
                                    />
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="px-6 py-4 bg-secondary/20 flex justify-between items-center">
        <span className="text-xs font-semibold text-muted-foreground">
          Showing {rows.length} of {total.toLocaleString()} {isPages ? 'pages' : 'keywords'}
        </span>
        {hasMore && (
          <button
            className="text-xs font-bold text-primary hover:underline flex items-center gap-1 disabled:text-muted-foreground"
            onClick={onLoadMore}
            disabled={loading}
          >
            {loading && <RefreshCw className="h-3 w-3 animate-spin" />}
            Load More
          </button>
        )}
      </div>
    </div>
  );
}

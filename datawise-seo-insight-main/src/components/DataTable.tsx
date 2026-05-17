import React from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown, Download } from "lucide-react";
import { downloadCSV } from "@/lib/csvUtils";
import { cn, isNumericColumn, getComparisonColor, calculateColumnStats } from "@/lib/utils";
import { KeywordMetricBadge, KeywordMetricLabel } from "@/components/KeywordMetricBadge";
import { getKeywordMetricStats, isKeywordMetricKey } from "@/lib/keyword-metrics";
import { TrafficMetricLabel } from "@/components/TrafficMetricLabel";
import { isTrafficMetricKey } from "@/lib/traffic-metrics";
import { sortTableRows, type TableSortState } from "@/lib/table-sort";

export interface DataTableProps {
  data: object[];
  title: string;
  description?: string;
  loading?: boolean;
  enableComparison?: boolean;
  metricMode?: 'none' | 'keyword-research' | 'traffic-estimation';
  toolbarActions?: React.ReactNode;
  getRowId?: (row: Record<string, unknown>, index: number) => string;
  selectedRowIds?: Set<string>;
  onSelectedRowIdsChange?: (next: Set<string>) => void;
  isRowSelectable?: (row: Record<string, unknown>, index: number) => boolean;
  renderRowActions?: (row: Record<string, unknown>, index: number) => React.ReactNode;
  rowActionsHeader?: string;
  enableSorting?: boolean;
}

export function DataTable({
  data,
  title,
  description,
  loading = false,
  enableComparison = false,
  metricMode = 'none',
  toolbarActions,
  getRowId,
  selectedRowIds,
  onSelectedRowIdsChange,
  isRowSelectable,
  renderRowActions,
  rowActionsHeader = 'Actions',
  enableSorting = true,
}: DataTableProps) {
  const hasSelection = Boolean(getRowId && selectedRowIds && onSelectedRowIdsChange);
  const hasRowActions = Boolean(renderRowActions);
  const [sortState, setSortState] = React.useState<TableSortState | null>(null);
  const safeData = React.useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const tableRows = React.useMemo(
    () =>
      enableSorting
        ? sortTableRows(safeData as Record<string, unknown>[], sortState)
        : (safeData as Record<string, unknown>[]),
    [enableSorting, safeData, sortState],
  );

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="mt-2 text-muted-foreground">Loading data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!safeData || safeData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </CardHeader>
        <CardContent>
          <div className="text-center py-8 text-muted-foreground">
            No data available
          </div>
        </CardContent>
      </Card>
    );
  }

  const handleDownloadCSV = () => {
    // Filter out React elements from data for CSV export
    const csvData = tableRows.map(row => {
      const rowRecord = row as Record<string, unknown>;
      const cleanRow: Record<string, unknown> = {};
      Object.keys(rowRecord).forEach(key => {
        const value = rowRecord[key];
        if (React.isValidElement(value)) {
          // Skip React elements in CSV export
          return;
        }
        cleanRow[key] = value;
      });
      return cleanRow;
    });
    downloadCSV(csvData, title.toLowerCase().replace(/\s+/g, '-'));
  };

  // Get columns from the first data item
  const columns = Object.keys(safeData[0] as Record<string, unknown>);
  const keywordMetricStats = metricMode === 'keyword-research' ? getKeywordMetricStats(safeData) : {};
  const selectableRowIds = hasSelection
    ? tableRows
        .map((row, index) => {
          const rowRecord = row as Record<string, unknown>;
          const selectable = isRowSelectable ? isRowSelectable(rowRecord, index) : true;
          return selectable ? getRowId!(rowRecord, index) : '';
        })
        .filter(Boolean)
    : [];
  const allSelected = selectableRowIds.length > 0 && selectableRowIds.every((id) => selectedRowIds!.has(id));
  const someSelected = !allSelected && selectableRowIds.some((id) => selectedRowIds!.has(id));
  
  // Calculate column statistics for comparison mode
  const columnStats = enableComparison && safeData.length > 1 ?
    columns.reduce((stats, column) => {
      stats[column] = calculateColumnStats(safeData, column);
      return stats;
    }, {} as Record<string, ReturnType<typeof calculateColumnStats>>) : {};

  const handleSortColumn = (column: string) => {
    if (!enableSorting) return;

    setSortState((current) => {
      if (!current || current.column !== column) {
        return { column, direction: 'asc' };
      }

      if (current.direction === 'asc') {
        return { column, direction: 'desc' };
      }

      return null;
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription>{description}</CardDescription>}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          {toolbarActions}
          <Button onClick={handleDownloadCSV} variant="outline" size="sm">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                {hasSelection && (
                  <TableHead className="w-10">
                    <Checkbox
                      aria-label="Select all keywords"
                      checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                      disabled={selectableRowIds.length === 0}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedRowIds);
                        if (checked === true) {
                          selectableRowIds.forEach((id) => next.add(id));
                        } else {
                          selectableRowIds.forEach((id) => next.delete(id));
                        }
                        onSelectedRowIdsChange?.(next);
                      }}
                    />
                  </TableHead>
                )}
                {columns.map((column) => {
                  const activeSort = sortState?.column === column ? sortState.direction : null;
                  const SortIcon = activeSort === 'asc' ? ArrowUp : activeSort === 'desc' ? ArrowDown : ArrowUpDown;
                  const label =
                    metricMode === 'keyword-research' && isKeywordMetricKey(column) ? (
                      <KeywordMetricLabel metric={column} labelVariant="short" />
                    ) : metricMode === 'traffic-estimation' && isTrafficMetricKey(column) ? (
                      <TrafficMetricLabel metric={column} labelVariant="short" />
                    ) : (
                      column.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
                    );

                  return (
                    <TableHead
                      key={column}
                      className={cn('whitespace-nowrap', enableSorting && 'cursor-pointer select-none')}
                      aria-sort={activeSort === 'asc' ? 'ascending' : activeSort === 'desc' ? 'descending' : 'none'}
                      tabIndex={enableSorting ? 0 : undefined}
                      onClick={(event) => {
                        if (!enableSorting) return;
                        const target = event.target as HTMLElement;
                        if (target.closest('button, a')) return;
                        handleSortColumn(column);
                      }}
                      onKeyDown={(event) => {
                        if (!enableSorting || (event.key !== 'Enter' && event.key !== ' ')) return;
                        const target = event.target as HTMLElement;
                        if (target.closest('button, a')) return;
                        event.preventDefault();
                        handleSortColumn(column);
                      }}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {label}
                        {enableSorting && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className={cn(
                              'h-6 w-6 text-muted-foreground hover:text-foreground',
                              activeSort && 'text-foreground',
                            )}
                            aria-label={`Sort by ${column.replace(/_/g, ' ')}`}
                            aria-pressed={Boolean(activeSort)}
                            onClick={() => handleSortColumn(column)}
                          >
                            <SortIcon className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </span>
                    </TableHead>
                  );
                })}
                {hasRowActions && (
                  <TableHead className="w-16 text-right">{rowActionsHeader}</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {tableRows.map((row, index) => {
                const rowRecord = row as Record<string, unknown>;
                const rowId = getRowId?.(rowRecord, index) || String(index);
                const selectable = hasSelection
                  ? (isRowSelectable ? isRowSelectable(rowRecord, index) : true)
                  : false;

                return (
                  <TableRow key={`${rowId}-${index}`}>
                    {hasSelection && (
                      <TableCell className="w-10">
                        <Checkbox
                          aria-label={`Select ${rowRecord.keyword || 'row'}`}
                          checked={selectable && selectedRowIds!.has(rowId)}
                          disabled={!selectable}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedRowIds);
                            if (checked === true) next.add(rowId);
                            else next.delete(rowId);
                            onSelectedRowIdsChange?.(next);
                          }}
                        />
                      </TableCell>
                    )}
                    {columns.map((column) => {
                    const value = rowRecord[column];
                    const displayValue = typeof value === 'object' && value !== null ?
                      (React.isValidElement(value) ? value : JSON.stringify(value)) :
                      value?.toString() || '-';
                    
                    // Apply color coding for comparison mode
                    let cellClassName = "whitespace-nowrap";
                    
                    if (enableComparison && safeData.length > 1 && columnStats[column]?.hasNumericData && isNumericColumn(value)) {
                      const { min, max } = columnStats[column];
                      const colorClass = getComparisonColor(Number(value), min, max);
                      cellClassName = cn(cellClassName, colorClass);
                    }

                    const content = metricMode === 'keyword-research' && isKeywordMetricKey(column) ? (
                      <KeywordMetricBadge metric={column} value={value} stats={keywordMetricStats[column]} />
                    ) : displayValue;
                    
                    return (
                      <TableCell key={column} className={cellClassName}>
                        {content}
                      </TableCell>
                    );
                    })}
                    {hasRowActions && (
                      <TableCell className="w-16 text-right">
                        {renderRowActions?.(rowRecord, index)}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="mt-4 text-sm text-muted-foreground">
          Showing {safeData.length} results
        </div>
      </CardContent>
    </Card>
  );
}

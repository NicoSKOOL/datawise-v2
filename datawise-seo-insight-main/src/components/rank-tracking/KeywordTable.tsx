import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ArrowUpDown, Plus, ChevronUp, ChevronDown, Minus, Trash2, Monitor, Smartphone } from 'lucide-react';
import { locationOptions, languageOptions } from '@/lib/dataForSeoLocations';
import type { TrackedKeyword } from '@/types/rank-tracking';

const PAGE_SIZE = 50;

const locationLabelByCode = new Map(locationOptions.map((o) => [o.value, o.label]));
const languageLabelByCode = new Map(languageOptions.map((o) => [o.value, o.label]));

function formatLocale(locationCode: number, languageCode: string) {
  const location = locationLabelByCode.get(locationCode) || locationCode.toString();
  const language = languageLabelByCode.get(languageCode) || languageCode;
  return `${location} / ${language}`;
}

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Date(`${value}Z`).toLocaleDateString();
}

interface KeywordTableProps {
  keywords: TrackedKeyword[];
  loading: boolean;
  onViewHistory: (keyword: TrackedKeyword) => void;
  onDelete: (keywordId: string) => void;
  onAddKeywords: () => void;
}

export default function KeywordTable({ keywords, loading, onViewHistory, onDelete, onAddKeywords }: KeywordTableProps) {
  const [page, setPage] = useState(0);

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-5 w-2/5" />
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-5 w-1/4" />
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (keywords.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] rounded-xl border-2 border-dashed">
        <ArrowUpDown className="h-10 w-10 text-muted-foreground/40 mb-4" />
        <h3 className="text-lg font-medium text-muted-foreground">No keywords yet</h3>
        <p className="text-sm text-muted-foreground/60 mt-1 mb-4">Add keywords to start tracking their rankings</p>
        <Button variant="outline" onClick={onAddKeywords}>
          <Plus className="h-4 w-4 mr-2" />
          Add Your First Keywords
        </Button>
      </div>
    );
  }

  const totalPages = Math.ceil(keywords.length / PAGE_SIZE);
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = keywords.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[38%]">Keyword</TableHead>
              <TableHead className="text-center">Position</TableHead>
              <TableHead className="text-center">Change</TableHead>
              <TableHead className="text-center">Locale</TableHead>
              <TableHead className="text-center">Last Checked</TableHead>
              <TableHead className="w-[80px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((keyword) => {
              const change = (keyword.position != null && keyword.prev_position != null)
                ? keyword.prev_position - keyword.position
                : null;

              return (
                <TableRow key={keyword.id} className="cursor-pointer hover:bg-muted/50" onClick={() => onViewHistory(keyword)}>
                  <TableCell className="font-medium">{keyword.keyword}</TableCell>
                  <TableCell className="text-center">
                    {keyword.position != null ? (
                      <Badge
                        variant="secondary"
                        className={
                          keyword.position <= 3 ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' :
                          keyword.position <= 10 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' :
                          keyword.position <= 20 ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400' :
                          'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                        }
                      >
                        {keyword.position}
                      </Badge>
                    ) : keyword.checked_at ? (
                      <span className="text-muted-foreground text-sm" title="Checked, but the domain was not found in the top 100 results">&gt;100</span>
                    ) : (
                      <span className="text-muted-foreground text-sm">Not checked</span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    {change != null ? (
                      <span className={`inline-flex items-center gap-1 text-sm font-medium ${change > 0 ? 'text-green-600' : change < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                        {change > 0 ? <ChevronUp className="h-4 w-4" /> : change < 0 ? <ChevronDown className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                        {change !== 0 ? Math.abs(change) : ''}
                      </span>
                    ) : (
                      <Minus className="h-4 w-4 text-muted-foreground mx-auto" />
                    )}
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      {keyword.device === 'mobile'
                        ? <Smartphone className="h-3.5 w-3.5" aria-label="Mobile" />
                        : <Monitor className="h-3.5 w-3.5" aria-label="Desktop" />}
                      {formatLocale(keyword.location_code, keyword.language_code)}
                    </span>
                  </TableCell>
                  <TableCell className="text-center text-sm text-muted-foreground">
                    {formatDate(keyword.checked_at)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={(event) => { event.stopPropagation(); onDelete(keyword.id); }}
                    >
                      <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
            <span>
              {safePage * PAGE_SIZE + 1}-{Math.min((safePage + 1) * PAGE_SIZE, keywords.length)} of {keywords.length} keywords
            </span>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" disabled={safePage === 0} onClick={() => setPage(safePage - 1)}>
                Previous
              </Button>
              <Button variant="outline" size="sm" disabled={safePage >= totalPages - 1} onClick={() => setPage(safePage + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

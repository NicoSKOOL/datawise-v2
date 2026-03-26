import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { RefreshCw, ArrowUpDown, Plus, ChevronUp, ChevronDown, Minus, Trash2 } from 'lucide-react';
import { locationOptions, languageOptions } from '@/lib/dataForSeoLocations';
import type { TrackedKeyword } from '@/types/rank-tracking';

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
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
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
            {keywords.map((keyword) => {
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
                    ) : (
                      <span className="text-muted-foreground text-sm">Not ranking</span>
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
                    {formatLocale(keyword.location_code, keyword.language_code)}
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
      </CardContent>
    </Card>
  );
}

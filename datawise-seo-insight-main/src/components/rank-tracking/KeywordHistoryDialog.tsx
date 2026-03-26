import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import PositionHistoryChart from './PositionHistoryChart';
import type { TrackedKeyword, HistoryEntry } from '@/types/rank-tracking';

function formatDate(value: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!value) return 'Never';
  return new Date(`${value}Z`).toLocaleDateString(undefined, options);
}

interface KeywordHistoryDialogProps {
  keyword: TrackedKeyword | null;
  history: HistoryEntry[];
  loading: boolean;
  onClose: () => void;
}

export default function KeywordHistoryDialog({ keyword, history, loading, onClose }: KeywordHistoryDialogProps) {
  return (
    <Dialog open={!!keyword} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Position History: {keyword?.keyword}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : history.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">No history yet. Check rankings to start tracking positions.</p>
        ) : (
          <div className="space-y-4">
            <PositionHistoryChart history={history} keywordName={keyword?.keyword || ''} />
            <div className="max-h-[300px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-center">Position</TableHead>
                    <TableHead className="text-center">Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((entry, index) => {
                    const previousEntry = history[index + 1];
                    const change = (entry.position != null && previousEntry?.position != null)
                      ? previousEntry.position - entry.position
                      : null;

                    return (
                      <TableRow key={`${entry.checked_at}-${index}`}>
                        <TableCell className="text-sm">
                          {formatDate(entry.checked_at, { month: 'short', day: 'numeric', year: 'numeric' })}
                        </TableCell>
                        <TableCell className="text-center">
                          {entry.position != null ? (
                            <Badge variant="secondary">{entry.position}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">N/A</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {change != null ? (
                            <span className={`inline-flex items-center gap-1 text-sm ${change > 0 ? 'text-green-600' : change < 0 ? 'text-red-500' : 'text-muted-foreground'}`}>
                              {change > 0 ? <TrendingUp className="h-3 w-3" /> : change < 0 ? <TrendingDown className="h-3 w-3" /> : null}
                              {change !== 0 ? Math.abs(change) : '--'}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">--</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

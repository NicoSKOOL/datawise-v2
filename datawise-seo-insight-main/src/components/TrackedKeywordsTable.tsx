import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Trash2, TrendingUp, TrendingDown, Minus, ExternalLink } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface TrackedKeyword {
  id: string;
  keyword: string;
  location_code: number;
  language_code: string;
  device: string;
  current_rank: number | null;
  previous_rank: number | null;
  last_checked: string | null;
  url: string | null;
  search_volume: number | null;
}

interface TrackedKeywordsTableProps {
  keywords: TrackedKeyword[];
  loading: boolean;
  onDelete: (keywordId: string) => void;
}

export function TrackedKeywordsTable({ keywords, loading, onDelete }: TrackedKeywordsTableProps) {
  const getRankDelta = (current: number | null, previous: number | null) => {
    if (!current || !previous) return null;
    return previous - current; // Positive = improvement (moved up)
  };

  const getRankBadgeColor = (rank: number | null) => {
    if (!rank) return "secondary";
    if (rank <= 3) return "default";
    if (rank <= 10) return "secondary";
    if (rank <= 20) return "outline";
    return "secondary";
  };

  const getRankDeltaIcon = (delta: number | null) => {
    if (!delta) return <Minus className="h-3 w-3" />;
    if (delta > 0) return <TrendingUp className="h-3 w-3 text-success" />;
    return <TrendingDown className="h-3 w-3 text-destructive" />;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tracked Keywords</CardTitle>
          <CardDescription>Loading keywords...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Tracked Keywords</CardTitle>
        <CardDescription>
          {keywords.length} keyword{keywords.length !== 1 ? 's' : ''} being monitored
        </CardDescription>
      </CardHeader>
      <CardContent>
        {keywords.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No keywords tracked yet. Add keywords to start monitoring rankings.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Keyword</TableHead>
                  <TableHead className="text-center">Current Rank</TableHead>
                  <TableHead className="text-center">Change</TableHead>
                  <TableHead className="text-right">Search Volume</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead>Device</TableHead>
                  <TableHead>Last Checked</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {keywords.map((keyword) => {
                  const delta = getRankDelta(keyword.current_rank, keyword.previous_rank);
                  return (
                    <TableRow key={keyword.id}>
                      <TableCell className="font-medium">{keyword.keyword}</TableCell>
                      <TableCell className="text-center">
                        {keyword.current_rank ? (
                          <Badge variant={getRankBadgeColor(keyword.current_rank)}>
                            #{keyword.current_rank}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-sm">Not ranking</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {delta !== null && (
                          <div className="flex items-center justify-center gap-1">
                            {getRankDeltaIcon(delta)}
                            <span className={delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : ""}>
                              {Math.abs(delta)}
                            </span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {keyword.search_volume ? keyword.search_volume.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell>
                        {keyword.url ? (
                          <a 
                            href={keyword.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-1 text-primary hover:underline text-sm"
                          >
                            <ExternalLink className="h-3 w-3" />
                            <span className="max-w-[200px] truncate">
                              {new URL(keyword.url).pathname}
                            </span>
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-sm">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {keyword.device}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {keyword.last_checked ? (
                          <span className="text-sm text-muted-foreground">
                            {formatDistanceToNow(new Date(keyword.last_checked), { addSuffix: true })}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Never</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onDelete(keyword.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

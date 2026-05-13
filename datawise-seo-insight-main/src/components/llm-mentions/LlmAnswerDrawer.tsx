import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ExternalLink } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import type { LlmSearchRow } from '@/lib/llm-mentions';

export interface LlmAnswerDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  rows: LlmSearchRow[];
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
}

interface CitationEntry {
  n: number;
  url: string;
}

export function cleanAnswerMarkdown(raw: string): { cleaned: string; citations: CitationEntry[] } {
  const citations: CitationEntry[] = [];
  const seen = new Set<string>();
  const regex = /\[\[(\d+)\]\]\((https?:\/\/[^)]+)\)/g;

  let cleaned = raw.replace(regex, (_match, nStr, url) => {
    const n = parseInt(nStr, 10);
    const key = `${n}::${url}`;
    if (!seen.has(key)) {
      seen.add(key);
      citations.push({ n, url });
    }
    return ` [${n}]`;
  });

  cleaned = cleaned.trim();
  return { cleaned, citations };
}

function platformLabel(platform: string | undefined): string {
  if (platform === 'google') return 'Google AIO';
  if (platform === 'chat_gpt') return 'ChatGPT';
  return platform || 'Unknown';
}

function platformColor(platform: string | undefined): string {
  if (platform === 'google') return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200';
  if (platform === 'chat_gpt') return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200';
  return 'bg-muted text-muted-foreground';
}

function AnswerBlock({ row, index, total }: { row: LlmSearchRow; index: number; total: number }) {
  const formattedDate = row.last_response_at
    ? new Date(row.last_response_at).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : null;

  const { cleaned, citations } = row.answer
    ? cleanAnswerMarkdown(row.answer)
    : { cleaned: '', citations: [] as CitationEntry[] };

  const sources = row.sources || [];

  return (
    <div>
      {total > 1 && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs font-semibold text-muted-foreground">Answer {index + 1}</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${platformColor(row.platform)}`}>
            {platformLabel(row.platform)}
          </span>
          {row.model_name && (
            <Badge variant="outline" className="text-xs">
              {row.model_name}
            </Badge>
          )}
          {formattedDate && (
            <span className="text-xs text-muted-foreground">{formattedDate}</span>
          )}
        </div>
      )}

      {total === 1 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${platformColor(row.platform)}`}>
            {platformLabel(row.platform)}
          </span>
          {row.model_name && (
            <Badge variant="outline" className="text-xs">
              {row.model_name}
            </Badge>
          )}
          {formattedDate && (
            <span className="text-xs text-muted-foreground">{formattedDate}</span>
          )}
        </div>
      )}

      {cleaned ? (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No answer available.</p>
      )}

      {citations.length > 0 && (
        <div className="space-y-2 mt-4">
          <h3 className="text-sm font-semibold text-foreground">
            Citations ({citations.length})
          </h3>
          <ol className="space-y-1.5 list-none p-0">
            {citations.map((c) => (
              <li key={`${c.n}-${c.url}`} className="flex items-start gap-2 text-sm">
                <span className="text-muted-foreground shrink-0 text-xs pt-0.5 w-5 text-right">
                  [{c.n}]
                </span>
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline break-all inline-flex items-center gap-1 text-xs"
                >
                  {(() => {
                    try {
                      return new URL(c.url).hostname.replace(/^www\./, '');
                    } catch {
                      return c.url.slice(0, 60);
                    }
                  })()}
                  <ExternalLink className="h-3 w-3 shrink-0" />
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}

      {sources.length > 0 && (
        <div className="space-y-2 mt-4">
          <h3 className="text-sm font-semibold text-foreground">
            Sources ({sources.length})
          </h3>
          <ol className="space-y-2 list-none p-0">
            {sources.map((src, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <span className="text-muted-foreground shrink-0 w-5 text-right text-xs pt-0.5">
                  {i + 1}.
                </span>
                <div className="min-w-0">
                  <a
                    href={src.url || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium hover:underline inline-flex items-center gap-1 text-sm"
                  >
                    {src.title || src.source_name || src.domain || src.url}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                  {src.snippet && (
                    <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">
                      {src.snippet}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

export function LlmAnswerDrawer({
  open,
  onOpenChange,
  title,
  subtitle,
  rows,
  loading = false,
  error,
  emptyMessage = 'No answers found for this query.',
}: LlmAnswerDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-3xl lg:max-w-4xl overflow-y-auto">
        <SheetHeader className="space-y-1 pr-2">
          <SheetTitle className="text-base leading-snug text-left">{title || '(no title)'}</SheetTitle>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {loading && (
            <div className="space-y-4">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-32 w-full rounded-lg" />
              ))}
            </div>
          )}

          {!loading && error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          {!loading && !error && rows.length === 0 && (
            <p className="text-sm text-muted-foreground">{emptyMessage}</p>
          )}

          {!loading && !error && rows.length > 0 && rows.map((row, i) => (
            <div key={i}>
              <AnswerBlock row={row} index={i} total={rows.length} />
              {i < rows.length - 1 && (
                <hr className="mt-6 border-border" />
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

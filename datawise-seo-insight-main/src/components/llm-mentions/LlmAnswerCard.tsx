import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ExternalLink } from 'lucide-react';
import type { LlmSearchRow, LlmSource } from '@/lib/llm-mentions';

interface LlmAnswerCardProps {
  row: LlmSearchRow;
}

function SourceChip({ source }: { source: LlmSource }) {
  const letter = (source.source_name || source.domain || '?').charAt(0).toUpperCase();
  const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500'];
  const colorIndex = letter.charCodeAt(0) % colors.length;

  return (
    <a
      href={source.url || '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-muted hover:bg-muted/80 transition-colors max-w-[140px] truncate"
      title={source.url}
    >
      <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-white text-[10px] font-bold shrink-0 ${colors[colorIndex]}`}>
        {letter}
      </span>
      <span className="truncate">{source.source_name || source.domain || source.url}</span>
    </a>
  );
}

function plainTextAnswer(markdown: string): string {
  return markdown
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\n{2,}/g, ' ')
    .trim();
}

function platformLabel(platform: string | undefined): string {
  if (!platform) return 'Unknown';
  if (platform === 'google') return 'Google AIO';
  if (platform === 'chat_gpt') return 'ChatGPT';
  return platform;
}

function platformColor(platform: string | undefined): string {
  if (platform === 'google') return 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200';
  if (platform === 'chat_gpt') return 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200';
  return 'bg-muted text-muted-foreground';
}

export function LlmAnswerCard({ row }: LlmAnswerCardProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  const snippet = row.answer ? plainTextAnswer(row.answer).slice(0, 200) : '';
  const hasMore = (row.answer?.length ?? 0) > 200;
  const visibleSources = (row.sources || []).slice(0, 5);

  const formattedDate = row.last_response_at
    ? new Date(row.last_response_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="border rounded-lg p-4 space-y-2 bg-card">
      <div className="flex items-start justify-between gap-2">
        <p className="font-semibold text-sm leading-snug flex-1">{row.question || '(no question)'}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${platformColor(row.platform)}`}>
            {platformLabel(row.platform)}
          </span>
          {row.model_name && (
            <Badge variant="outline" className="text-[11px] px-1.5 py-0">
              {row.model_name}
            </Badge>
          )}
          {formattedDate && (
            <span className="text-[11px] text-muted-foreground hidden sm:inline">{formattedDate}</span>
          )}
        </div>
      </div>

      {snippet && (
        <p className="text-sm text-muted-foreground leading-relaxed">
          {snippet}{hasMore && '…'}
        </p>
      )}

      {visibleSources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visibleSources.map((src, i) => (
            <SourceChip key={i} source={src} />
          ))}
        </div>
      )}

      {row.answer && (
        <div>
          <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setSheetOpen(true)}>
            View full answer
          </Button>
        </div>
      )}

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="text-base leading-snug pr-4">{row.question}</SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${platformColor(row.platform)}`}>
                {platformLabel(row.platform)}
              </span>
              {row.model_name && <Badge variant="outline" className="text-xs">{row.model_name}</Badge>}
              {formattedDate && <span className="text-xs text-muted-foreground">{formattedDate}</span>}
            </div>

            <div className="bg-muted/40 rounded-lg p-4">
              <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{row.answer}</pre>
            </div>

            {(row.sources || []).length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-semibold">Sources ({row.sources!.length})</p>
                <ul className="space-y-2">
                  {row.sources!.map((src, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-muted-foreground shrink-0 w-5 text-right">{i + 1}.</span>
                      <div className="min-w-0">
                        <a
                          href={src.url || '#'}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium hover:underline inline-flex items-center gap-1"
                        >
                          {src.title || src.source_name || src.domain || src.url}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                        {src.snippet && (
                          <p className="text-muted-foreground text-xs mt-0.5 line-clamp-2">{src.snippet}</p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

import ReactMarkdown from 'react-markdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Megaphone } from 'lucide-react';
import { AI_ENGINE_LABELS, AI_OUTCOME_COLORS, cleanTrackingDomain } from '@/lib/ai-tracking';
import { verdictFor, competitorDomains, type EngineCheckResponse, type VerdictTone } from '@/lib/ai-engines';
import EngineLogo from '@/components/rank-tracking/ai/EngineLogo';
import { ExportMenu } from '@/components/export/ExportMenu';
import { buildAIVisibilityReport } from '@/lib/export/adapters/aiVisibility';

interface EngineResultPanelProps {
  result: EngineCheckResponse;
  query: string;
  brandDomain: string;
}

const TONE_STYLE: Record<VerdictTone, { bg: string; fg: string }> = {
  cited: { bg: AI_OUTCOME_COLORS.cited, fg: '#FFFFFF' },
  mentioned: { bg: AI_OUTCOME_COLORS.mentioned, fg: '#0F4A28' },
  retrieved: { bg: AI_OUTCOME_COLORS.retrieved, fg: '#7A5A12' },
  absent: { bg: AI_OUTCOME_COLORS.absent, fg: '#5A6968' },
  none: { bg: '#F1F4F2', fg: '#5A6968' },
};

function isOwn(domain: string, brandDomain: string) {
  const me = cleanTrackingDomain(brandDomain);
  return !!me && (domain === me || domain.endsWith(`.${me}`) || me.endsWith(`.${domain}`));
}

export default function EngineResultPanel({ result, query, brandDomain }: EngineResultPanelProps) {
  const { answer, classification, engine } = result;
  const label = AI_ENGINE_LABELS[engine];
  const verdict = verdictFor(classification, label);
  const tone = TONE_STYLE[verdict.tone];
  const competitors = brandDomain ? competitorDomains(answer, brandDomain).slice(0, 5) : [];
  const renderedAds = answer.ads.filter((ad) => ad.rendered);
  const cleanBrand = cleanTrackingDomain(brandDomain);

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <EngineLogo engine={engine} className="h-6 w-6" />
          <span className="rounded-full px-3 py-1 text-sm font-semibold" style={{ background: tone.bg, color: tone.fg }}>{verdict.label}</span>
          {answer.model && <Badge variant="outline" className="text-xs">{answer.model}</Badge>}
          <Badge variant="outline" className="text-xs">{result.locale.location_code} · {result.locale.language_code}</Badge>
          {renderedAds.length > 0 && (
            <Badge variant="secondary" className="gap-1 text-xs">
              <Megaphone className="h-3 w-3" />
              Sponsored results: {renderedAds.map((ad) => ad.advertiser || ad.domain).filter(Boolean).join(', ')}
            </Badge>
          )}
          <div className="ml-auto">
            <ExportMenu
              surface={`ai-visibility-${engine}`}
              identifier={query}
              buildPayload={() => buildAIVisibilityReport({
                engine: label,
                keyword: query,
                brandDomain: cleanBrand || undefined,
                brandCited: classification ? classification.status === 'cited' : null,
                citationCount: classification ? answer.cited.filter((s) => isOwn(s.domain, brandDomain)).length : null,
                citationPosition: classification?.citation_position ?? null,
                topCompetitors: competitors.map((c) => c.domain),
                answerText: answer.answerMarkdown || answer.answerText,
                sources: answer.cited.map((s) => ({
                  title: s.title ?? undefined,
                  url: s.url ?? undefined,
                  domain: s.domain,
                  isBrand: isOwn(s.domain, brandDomain),
                })),
              })}
            />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">What {label} answered</CardTitle></CardHeader>
          <CardContent className="prose prose-sm max-w-none dark:prose-invert">
            {answer.answerMarkdown
              ? <ReactMarkdown>{answer.answerMarkdown}</ReactMarkdown>
              : <p className="text-muted-foreground">No answer text was returned.</p>}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="text-base">Cited sources ({answer.cited.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {answer.cited.length === 0 && <p className="text-sm text-muted-foreground">No sources were cited.</p>}
              {answer.cited.map((s) => {
                const own = isOwn(s.domain, brandDomain);
                return (
                  <div key={`${s.position}-${s.url ?? s.domain}`} className={`flex items-start gap-2 rounded-md px-2 py-1 text-sm ${own ? 'bg-[#E3F1E9]' : ''}`}>
                    <span className="w-6 shrink-0 text-xs font-bold tabular-nums text-muted-foreground">#{s.position}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{s.title || s.domain}</div>
                      <div className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                        {s.domain}
                        {own && <Badge className="ml-1 h-4 px-1 text-[10px]">you</Badge>}
                        {s.url && (
                          <a href={s.url} target="_blank" rel="noreferrer" aria-label="Open source">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {answer.retrieved.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Fetched, not cited ({answer.retrieved.length})</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {answer.retrieved.slice(0, 10).map((s) => (
                  <div key={`${s.position}-${s.url ?? s.domain}`} className={`truncate text-sm ${isOwn(s.domain, brandDomain) ? 'font-semibold' : 'text-muted-foreground'}`}>
                    {s.domain}
                    {s.url && <> · <a className="underline" href={s.url} target="_blank" rel="noreferrer">{s.url}</a></>}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {answer.brands.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Brands named</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {answer.brands.map((b) => (
                  <Badge key={b.name} variant="outline">{b.name}{b.category ? ` · ${b.category}` : ''}</Badge>
                ))}
              </CardContent>
            </Card>
          )}

          {competitors.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Most cited competitors</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {competitors.map((c) => (
                  <div key={c.domain} className="flex justify-between text-sm">
                    <span>{c.domain}</span>
                    <span className="tabular-nums text-muted-foreground">{c.count}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {answer.fanOut.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Sub-queries the engine ran</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {answer.fanOut.map((q) => <Badge key={q} variant="secondary">{q}</Badge>)}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

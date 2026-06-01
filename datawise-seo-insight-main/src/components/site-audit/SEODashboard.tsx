import { useState } from 'react';
import {
  Gauge,
  Server,
  Image as ImageIcon,
  FileCode2,
  Type,
  AlignLeft,
  ListOrdered,
  Tag,
  Target,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Sparkles,
  Wrench,
  TrendingDown,
  Copy,
  Check,
  Info,
  HelpCircle,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type {
  StructuredSEO,
  LoadingSummary,
  TitleAnalysis,
  MetaDescriptionAnalysis,
  HeadingsAnalysis,
  ImagesAnalysis,
  SchemaAnalysis,
  PerfBreakdown,
  AIAnalysis,
  KeywordCoverage,
} from '@/lib/site-audit';

// ============ UTILITIES ============

function formatBytes(bytes: number | null): string {
  if (bytes == null || bytes === 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatMs(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const VERDICT_STYLE: Record<
  LoadingSummary['verdict'],
  { text: string; bg: string; border: string; emoji: string }
> = {
  fast: {
    text: 'text-green-700',
    bg: 'bg-green-50',
    border: 'border-green-500/40',
    emoji: '⚡',
  },
  ok: {
    text: 'text-amber-700',
    bg: 'bg-amber-50',
    border: 'border-amber-500/40',
    emoji: '⏱',
  },
  slow: {
    text: 'text-orange-700',
    bg: 'bg-orange-50',
    border: 'border-orange-500/40',
    emoji: '⚠',
  },
  very_slow: {
    text: 'text-red-700',
    bg: 'bg-red-50',
    border: 'border-red-500/40',
    emoji: '🚨',
  },
  unknown: {
    text: 'text-slate-700',
    bg: 'bg-slate-50',
    border: 'border-slate-300',
    emoji: '?',
  },
};

// ============ LOADING SPEED HERO ============

export function LoadingSpeedHero({ loading }: { loading: LoadingSummary }) {
  const verdict = loading?.verdict || 'unknown';
  const score = loading?.score ?? 0;
  const style = VERDICT_STYLE[verdict] || VERDICT_STYLE.unknown;
  const scoreColor =
    score >= 90
      ? '#16a34a'
      : score >= 70
        ? '#22c55e'
        : score >= 50
          ? '#f59e0b'
          : '#ef4444';

  const size = 180;
  const radius = (size - 16) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;

  // Lead the user with the actual rendered loading time, not the abstract score
  const primarySeconds = loading?.seconds != null ? loading.seconds.toFixed(1) : null;
  const sampleCount = loading?.sample_count ?? 0;
  const hasMedianSource = loading?.score_source === 'lighthouse_median' && sampleCount > 0;
  const hasRange =
    loading?.seconds_min != null &&
    loading?.seconds_max != null &&
    Number.isFinite(loading.seconds_min) &&
    Number.isFinite(loading.seconds_max);
  const rangeLabel = hasRange
    ? loading.seconds_min === loading.seconds_max
      ? `${loading.seconds_min.toFixed(1)} s`
      : `${loading.seconds_min.toFixed(1)}-${loading.seconds_max.toFixed(1)} s`
    : null;
  const isVariable = loading?.confidence === 'medium' && loading?.straddles_lcp_threshold;

  return (
    <Card className={`${style.border} overflow-hidden`}>
      <CardContent className="p-0">
        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr]">
          {/* Score ring side */}
          <div className={`${style.bg} p-6 flex flex-col items-center justify-center gap-2 md:border-r border-b md:border-b-0`}>
            <div className="relative" style={{ width: size, height: size }}>
              <svg width={size} height={size} className="-rotate-90">
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke="currentColor"
                  strokeOpacity={0.12}
                  strokeWidth={10}
                  fill="none"
                />
                <circle
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  stroke={scoreColor}
                  strokeWidth={10}
                  fill="none"
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  style={{ transition: 'stroke-dashoffset 900ms ease-out' }}
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span
                  className="text-5xl font-bold tabular-nums leading-none"
                  style={{ color: scoreColor }}
                >
                  {score}
                </span>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground mt-1">
                  Speed score
                </span>
              </div>
            </div>
          </div>

          {/* Verdict side */}
          <div className="p-6 flex flex-col justify-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-xl">{style.emoji}</span>
              <span
                className={`text-xs font-semibold uppercase tracking-widest ${style.text}`}
              >
                {verdict === 'very_slow'
                  ? 'Very slow'
                  : verdict === 'unknown'
                    ? 'Not measured'
                    : verdict}
              </span>
            </div>

            {/* Primary metric: seconds-to-load, enormous */}
            <div>
              {primarySeconds ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-6xl font-bold tabular-nums leading-none">
                    {primarySeconds}
                  </span>
                  <span className="text-2xl font-medium text-muted-foreground">
                    seconds to load
                  </span>
                </div>
              ) : (
                <div className="text-lg text-muted-foreground">
                  Based on server response time
                </div>
              )}
              {primarySeconds && (hasMedianSource || rangeLabel || isVariable) && (
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  {hasMedianSource && (
                    <span className="rounded-full border bg-background px-2 py-0.5 font-medium">
                      Median of {sampleCount} runs
                    </span>
                  )}
                  {rangeLabel && (
                    <span className="rounded-full border bg-background px-2 py-0.5 font-medium">
                      Range {rangeLabel}
                    </span>
                  )}
                  {isVariable && (
                    <span className="rounded-full border border-amber-500/40 bg-amber-50 px-2 py-0.5 font-medium text-amber-700">
                      Variable near Google's 2.5s threshold
                    </span>
                  )}
                </div>
              )}
            </div>

            <p className="text-base leading-relaxed">{loading?.verdict_text || ''}</p>

            {/* Secondary stats */}
            <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 border-t">
              <StatChip
                icon={Server}
                label="Server response"
                value={formatMs(loading?.ttfb_ms ?? null)}
              />
              <StatChip
                icon={Gauge}
                label="Page weight"
                value={formatBytes(loading?.total_bytes ?? null)}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatChip({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground leading-tight">
          {label}
        </div>
        <div className="font-mono tabular-nums text-sm font-semibold leading-tight">
          {value}
        </div>
      </div>
    </div>
  );
}

// ============ AI SUMMARY (upgraded) ============

export function AISummaryCard({ ai }: { ai: AIAnalysis }) {
  // Defensive: old audits stored before the schema upgrade may be missing
  // likely_keywords / business_context. Fall back gracefully.
  const keywords = Array.isArray(ai?.likely_keywords) ? ai.likely_keywords : [];
  const priorityActions = Array.isArray(ai?.priority_actions) ? ai.priority_actions : [];
  const primaryKeyword = ai?.primary_keyword || '';

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardContent className="p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h3 className="font-semibold">Your audit, in plain English</h3>
        </div>

        {ai?.executive_summary && (
          <p className="text-base leading-relaxed">{ai.executive_summary}</p>
        )}

        {ai?.business_context && (
          <div className="rounded-md bg-primary/5 border border-primary/20 p-4 space-y-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-1">
                What we think your business does
              </div>
              <p className="text-sm leading-relaxed">{ai.business_context}</p>
            </div>

            {primaryKeyword && (
              <div className="border-t border-primary/15 pt-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  Your primary keyword
                </div>
                <div className="inline-flex items-center gap-2 rounded-md bg-primary text-primary-foreground px-3 py-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  <span className="text-sm font-semibold">{primaryKeyword}</span>
                </div>
              </div>
            )}

            {keywords.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
                  Related keywords
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {keywords.map((kw, i) => (
                    <Badge key={i} variant="outline" className="bg-background">
                      {kw}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {priorityActions.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-primary mb-2">
              Priority actions
            </div>
            <ol className="space-y-2.5">
              {priorityActions.map((a, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-semibold">{a.title}</p>
                    {a.why && <p className="text-xs text-muted-foreground mt-0.5">{a.why}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============ KEYWORD COVERAGE CARD ============

export function KeywordCoverageCard({ coverage }: { coverage: KeywordCoverage }) {
  if (!coverage || !coverage.primary_keyword) return null;
  const kw = coverage.primary_keyword;
  const lsi = Array.isArray(coverage.lsi_keywords) ? coverage.lsi_keywords : [];
  const locationCheck = (label: string, present: boolean) => (
    <div
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm border ${
        present
          ? 'bg-green-500/5 border-green-500/30 text-green-700'
          : 'bg-red-500/5 border-red-500/30 text-red-700'
      }`}
    >
      {present ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
      <span className="font-medium">{label}</span>
    </div>
  );

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            <h4 className="font-semibold">Keyword coverage</h4>
          </div>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Primary keyword
          </span>
          <span className="text-base font-semibold">"{kw}"</span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {locationCheck('In title', coverage.primary_in_title)}
          {locationCheck('In H1', coverage.primary_in_h1)}
          {locationCheck('In meta', coverage.primary_in_meta)}
          {locationCheck('In headings', coverage.primary_in_any_heading)}
        </div>

        {lsi.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
              Related (LSI) keywords
            </div>
            <div className="space-y-1.5">
              {lsi.map((k, i) => (
                <div key={i} className="flex items-center justify-between gap-2 text-sm">
                  <span className="font-medium truncate">{k.keyword}</span>
                  {k.found_in.length > 0 ? (
                    <div className="flex items-center gap-1 flex-wrap">
                      {k.found_in.slice(0, 4).map((loc, j) => (
                        <Badge
                          key={j}
                          variant="outline"
                          className="text-[10px] border-green-500/30 text-green-700 bg-green-500/5 font-mono"
                        >
                          {loc}
                        </Badge>
                      ))}
                    </div>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-red-500/30 text-red-700 bg-red-500/5"
                    >
                      not found
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm leading-relaxed">
          {coverage.verdict}
        </div>
      </CardContent>
    </Card>
  );
}

// ============ TITLE TAG CARD ============

const STATUS_STYLE: Record<
  'missing' | 'too_short' | 'too_long' | 'ok',
  { color: string; icon: React.ComponentType<{ className?: string }>; label: string }
> = {
  missing: { color: 'text-red-600', icon: XCircle, label: 'Missing' },
  too_short: { color: 'text-amber-600', icon: AlertTriangle, label: 'Too short' },
  too_long: { color: 'text-amber-600', icon: AlertTriangle, label: 'Too long' },
  ok: { color: 'text-green-600', icon: CheckCircle2, label: 'Good' },
};

export function TitleCard({
  title,
  aiVerdict,
}: {
  title: TitleAnalysis;
  aiVerdict?: AIAnalysis['title_verdict'];
}) {
  const status = (title?.status || 'ok') as keyof typeof STATUS_STYLE;
  const style = STATUS_STYLE[status] || STATUS_STYLE.ok;
  const Icon = style.icon;
  const length = title?.length ?? 0;
  const text = title?.text ?? null;
  const present = title?.present ?? false;
  const source = title?.source ?? null;
  const issues = Array.isArray(title?.issues) ? title.issues : [];
  const suggestion = title?.suggestion || '';
  // Prefer AI-generated per-finding issues + rewrite when available
  const aiIssues = Array.isArray(aiVerdict?.issues) ? aiVerdict.issues : [];
  const combinedIssues = aiIssues.length > 0 ? aiIssues : issues;
  const aiRewrite = aiVerdict?.suggested_rewrite || '';

  // Length meter: 0-70 char range, ideal zone 50-60
  const pct = Math.min(100, (length / 70) * 100);
  const inIdealZone = length >= 50 && length <= 60;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Type className="h-5 w-5 text-muted-foreground" />
            <h4 className="font-semibold">Title Tag</h4>
          </div>
          <div className={`flex items-center gap-1.5 text-sm font-medium ${style.color}`}>
            <Icon className="h-4 w-4" />
            {style.label}
          </div>
        </div>

        {/* Current title display */}
        {text ? (
          <div className="rounded-md bg-muted/40 border p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Current
              </div>
              <SourceBadge source={source} />
            </div>
            <p className="text-sm font-medium leading-snug break-words">{text}</p>
          </div>
        ) : (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            {present
              ? 'Your site has a title but we could not read it (your server may block crawlers).'
              : 'No title tag found on your homepage.'}
          </div>
        )}

        {/* Length meter */}
        {text && (
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">Length</span>
              <span className="text-sm font-mono tabular-nums font-semibold">
                {length} / 60 chars
              </span>
            </div>
            <div className="relative h-2 bg-muted rounded-full overflow-hidden">
              {/* Ideal zone (50-60 chars) */}
              <div
                className="absolute inset-y-0 bg-green-500/15"
                style={{ left: `${(50 / 70) * 100}%`, width: `${(10 / 70) * 100}%` }}
              />
              <div
                className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                  inIdealZone ? 'bg-green-500' : length > 60 ? 'bg-amber-500' : 'bg-blue-500'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
              <span>0</span>
              <span className="text-green-600 font-medium">Ideal: 50–60</span>
              <span>70+</span>
            </div>
          </div>
        )}

        {/* Issues */}
        {combinedIssues.length > 0 && (
          <div className="space-y-1">
            {combinedIssues.map((issue, i) => (
              <p key={i} className="text-sm text-muted-foreground">
                • {issue}
              </p>
            ))}
          </div>
        )}

        {/* AI suggested rewrite */}
        {aiRewrite ? (
          <SuggestedRewrite
            text={aiRewrite}
            label="Suggested rewrite"
            hint="50–60 chars, leads with your primary keyword, ends with brand"
          />
        ) : (
          <HowToFix text={suggestion} />
        )}
      </CardContent>
    </Card>
  );
}

// ============ META DESCRIPTION CARD ============

export function MetaDescriptionCard({
  meta,
  aiVerdict,
}: {
  meta: MetaDescriptionAnalysis;
  aiVerdict?: AIAnalysis['meta_verdict'];
}) {
  const status = (meta?.status || 'ok') as keyof typeof STATUS_STYLE;
  const style = STATUS_STYLE[status] || STATUS_STYLE.ok;
  const Icon = style.icon;
  const length = meta?.length ?? 0;
  const text = meta?.text ?? null;
  const hasCta = meta?.has_cta ?? false;
  const source = meta?.source ?? null;
  const isGoogleSnippet = meta?.is_google_snippet ?? false;
  const issues = Array.isArray(meta?.issues) ? meta.issues : [];
  const suggestion = meta?.suggestion || '';
  const aiIssues = Array.isArray(aiVerdict?.issues) ? aiVerdict.issues : [];
  const combinedIssues = aiIssues.length > 0 ? aiIssues : issues;
  const aiRewrite = aiVerdict?.suggested_rewrite || '';
  const pct = Math.min(100, (length / 165) * 100);
  const inIdealZone = length >= 140 && length <= 155;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlignLeft className="h-5 w-5 text-muted-foreground" />
            <h4 className="font-semibold">Meta Description</h4>
          </div>
          <div className={`flex items-center gap-1.5 text-sm font-medium ${style.color}`}>
            <Icon className="h-4 w-4" />
            {style.label}
          </div>
        </div>

        {text ? (
          <div className="rounded-md bg-muted/40 border p-3">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Current
              </div>
              <SourceBadge source={source} />
            </div>
            <p className="text-sm leading-snug break-words">{text}</p>
            {isGoogleSnippet && (
              <p className="text-[11px] text-amber-700 mt-2 leading-relaxed">
                ⚠ This is the snippet Google auto-generates — your real <code>&lt;meta&gt;</code> tag is missing or unreadable. Add a real tag so you control what Google shows.
              </p>
            )}
          </div>
        ) : (
          <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            No meta description on your homepage. Google will auto-generate a snippet — usually poorly.
          </div>
        )}

        {text && (
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">Length</span>
              <span className="text-sm font-mono tabular-nums font-semibold">
                {length} / 155 chars
              </span>
            </div>
            <div className="relative h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 bg-green-500/15"
                style={{ left: `${(140 / 165) * 100}%`, width: `${(15 / 165) * 100}%` }}
              />
              <div
                className={`absolute inset-y-0 left-0 rounded-full transition-all ${
                  inIdealZone ? 'bg-green-500' : length > 155 ? 'bg-amber-500' : 'bg-blue-500'
                }`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
              <span>0</span>
              <span className="text-green-600 font-medium">Ideal: 140–155</span>
              <span>165+</span>
            </div>
          </div>
        )}

        {text && (
          <div className="flex items-center gap-2 text-sm">
            {hasCta ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" />
                <span className="text-muted-foreground">Has a call to action</span>
              </>
            ) : (
              <>
                <XCircle className="h-4 w-4 text-amber-600" />
                <span className="text-muted-foreground">No call to action detected</span>
              </>
            )}
          </div>
        )}

        {combinedIssues.length > 0 && (
          <div className="space-y-1">
            {combinedIssues.map((issue, i) => (
              <p key={i} className="text-sm text-muted-foreground">
                • {issue}
              </p>
            ))}
          </div>
        )}

        {aiRewrite ? (
          <SuggestedRewrite
            text={aiRewrite}
            label="Suggested rewrite"
            hint="140–155 chars, ends with a call-to-action verb"
          />
        ) : (
          <HowToFix text={suggestion} />
        )}
      </CardContent>
    </Card>
  );
}

// ============ HEADINGS CARD ============

export function HeadingsCard({
  headings,
  aiVerdict,
}: {
  headings: HeadingsAnalysis;
  aiVerdict?: AIAnalysis['headings_verdict'];
}) {
  const h1 = Array.isArray(headings?.h1) ? headings.h1 : [];
  const h2 = Array.isArray(headings?.h2) ? headings.h2 : [];
  const h3 = Array.isArray(headings?.h3) ? headings.h3 : [];
  const baseIssues = Array.isArray(headings?.issues) ? headings.issues : [];
  const aiIssues = Array.isArray(aiVerdict?.issues) ? aiVerdict.issues : [];
  const issues = aiIssues.length > 0 ? aiIssues : baseIssues;
  const totalCount = headings?.total_count ?? h1.length + h2.length + h3.length;
  const lhOrderScore = headings?.lighthouse_order_score ?? null;
  const allGood = (headings?.hierarchy_ok ?? true) && issues.length === 0;
  const suggestedH1 = aiVerdict?.suggested_h1 || '';

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListOrdered className="h-5 w-5 text-muted-foreground" />
            <h4 className="font-semibold">Heading Structure</h4>
          </div>
          {allGood ? (
            <div className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Good
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-amber-600 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Issues
            </div>
          )}
        </div>

        {/* Headings tree preview */}
        {h1.length + h2.length + h3.length > 0 ? (
          <div className="rounded-md bg-muted/40 border p-3 space-y-1 font-mono text-xs max-h-48 overflow-y-auto">
            {h1.slice(0, 3).map((h, i) => (
              <div key={`h1-${i}`} className="flex gap-2">
                <span className="text-red-600 font-bold">H1</span>
                <span className="truncate">{h}</span>
              </div>
            ))}
            {h2.slice(0, 5).map((h, i) => (
              <div key={`h2-${i}`} className="flex gap-2 pl-3">
                <span className="text-orange-600 font-bold">H2</span>
                <span className="truncate">{h}</span>
              </div>
            ))}
            {h3.slice(0, 5).map((h, i) => (
              <div key={`h3-${i}`} className="flex gap-2 pl-6">
                <span className="text-amber-600 font-bold">H3</span>
                <span className="truncate">{h}</span>
              </div>
            ))}
            {totalCount > 13 && (
              <div className="text-muted-foreground pl-3">
                …and {totalCount - 13} more
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-md bg-muted/20 border border-dashed p-3 text-sm text-muted-foreground">
            We could not read your headings directly. Lighthouse order-check score:{' '}
            <span className="font-semibold">
              {lhOrderScore == null ? 'n/a' : `${Math.round(lhOrderScore * 100)}/100`}
            </span>
          </div>
        )}

        {issues.length > 0 && (
          <div className="space-y-1">
            {issues.map((issue, i) => (
              <p key={i} className="text-sm text-muted-foreground">
                • {issue}
              </p>
            ))}
          </div>
        )}

        {!allGood && !suggestedH1 && (
          <HowToFix text="Use exactly one <h1> that states your page's main topic. Break content into sections with <h2> subheadings. Never skip levels — don't go from an H2 to an H4." />
        )}
        {suggestedH1 && (
          <SuggestedRewrite
            text={suggestedH1}
            label="Suggested H1"
            hint="Clearly states the page topic and includes your primary keyword"
          />
        )}
      </CardContent>
    </Card>
  );
}

// ============ IMAGES CARD ============

export function ImagesCard({ images }: { images: ImagesAnalysis }) {
  const [copiedAlt, setCopiedAlt] = useState(false);
  const webpSavingsBytes = images?.webp_savings_bytes ?? 0;
  const webpSavingsItems = Array.isArray(images?.webp_savings_items)
    ? images.webp_savings_items
    : [];
  const missingAlt = images?.missing_alt ?? 0;
  const missingAltSamples = Array.isArray(images?.missing_alt_samples)
    ? images.missing_alt_samples
    : [];
  const lighthouseAltScore = images?.lighthouse_alt_score ?? null;
  const pngCount = images?.png_count ?? 0;
  const pngSamples = Array.isArray(images?.png_samples) ? images.png_samples : [];
  const formatBreakdown = Array.isArray(images?.format_breakdown)
    ? images.format_breakdown
    : [];
  const totalImages = images?.total ?? 0;
  const hasWebpSavings = webpSavingsBytes > 0;
  const hasMissingAlt = missingAlt > 0;
  const hasPngs = pngCount > 0;
  const allGood =
    !hasWebpSavings && !hasMissingAlt && !hasPngs && lighthouseAltScore === 1;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-muted-foreground" />
            <h4 className="font-semibold">Images</h4>
          </div>
          {allGood ? (
            <div className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Good
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-amber-600 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Issues
            </div>
          )}
        </div>

        {/* Image count + format breakdown from direct HTML parse */}
        {totalImages > 0 && (
          <div className="rounded-md border bg-muted/20 p-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">Images on page</span>
              <span className="text-sm font-semibold tabular-nums">{totalImages}</span>
            </div>
            {formatBreakdown.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {formatBreakdown.map((f) => {
                  const isProblem = f.format === 'png' || f.format === 'gif';
                  return (
                    <Badge
                      key={f.format}
                      variant="outline"
                      className={`text-[10px] font-mono ${
                        isProblem
                          ? 'border-amber-500/40 text-amber-700 bg-amber-500/5'
                          : ''
                      }`}
                    >
                      {f.format.toUpperCase()} × {f.count}
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* PNG callout — the user specifically wants to flag these */}
        {hasPngs && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
            <div className="flex items-baseline gap-2 mb-1">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 translate-y-0.5" />
              <span className="text-sm font-semibold text-amber-800">
                {pngCount} PNG image{pngCount === 1 ? '' : 's'} — convert to WebP
              </span>
            </div>
            <p className="text-sm text-amber-900 leading-relaxed">
              PNG files are typically 30-70% larger than the equivalent WebP. Converting them will shrink your page weight noticeably without touching quality.
            </p>
            {pngSamples.length > 0 && (
              <div className="mt-2 space-y-1 font-mono text-[10px] text-amber-900">
                {pngSamples.slice(0, 6).map((img, i) => (
                  <div key={i} className="truncate break-all">
                    {img.src}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* WebP conversion callout */}
        {hasWebpSavings && (
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
            <div className="flex items-baseline gap-2 mb-1">
              <TrendingDown className="h-4 w-4 text-amber-600 flex-shrink-0 translate-y-0.5" />
              <span className="text-sm font-semibold text-amber-800">
                Your images are too heavy
              </span>
            </div>
            <p className="text-sm text-amber-900 leading-relaxed">
              Converting them to WebP format would save{' '}
              <span className="font-bold tabular-nums">{formatBytes(webpSavingsBytes)}</span>{' '}
              — making your site that much faster.
            </p>
            {webpSavingsItems.length > 0 && (
              <div className="mt-2 space-y-1 font-mono text-[10px]">
                {webpSavingsItems.slice(0, 4).map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-2 text-amber-900">
                    <span className="truncate">{item.url.split('/').pop() || item.url}</span>
                    <span className="font-semibold tabular-nums flex-shrink-0">
                      {formatBytes(item.savings_bytes)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Missing alt callout */}
        {hasMissingAlt && (
          <div className="rounded-md bg-red-50 border border-red-200 p-3">
            <div className="flex items-baseline gap-2 mb-1">
              <XCircle className="h-4 w-4 text-red-600 flex-shrink-0 translate-y-0.5" />
              <span className="text-sm font-semibold text-red-800">
                {missingAlt} image{missingAlt === 1 ? '' : 's'} missing alt text
              </span>
            </div>
            <p className="text-sm text-red-900 leading-relaxed">
              Alt text is required for accessibility and feeds Google Images. Add a short description of what each image shows.
            </p>
            {missingAltSamples.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11px] font-medium text-red-800">
                    {missingAltSamples.length === missingAlt
                      ? `All ${missingAltSamples.length} image${missingAltSamples.length === 1 ? '' : 's'}`
                      : `Showing ${missingAltSamples.length} of ${missingAlt}`}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          missingAltSamples.map((item) => item.src).join('\n')
                        );
                        setCopiedAlt(true);
                        setTimeout(() => setCopiedAlt(false), 1800);
                      } catch {
                        /* ignore */
                      }
                    }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-red-700 hover:text-red-900 transition-colors"
                  >
                    {copiedAlt ? (
                      <>
                        <Check className="h-3 w-3" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        Copy all
                      </>
                    )}
                  </button>
                </div>
                <div className="max-h-48 overflow-y-auto rounded border border-red-200/60 bg-red-50/40 p-1.5 space-y-1 font-mono text-[10px] text-red-900">
                  {missingAltSamples.map((item, i) => {
                    const isLink = /^(https?:)?\/\//i.test(item.src);
                    return isLink ? (
                      <a
                        key={i}
                        href={item.src}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate break-all underline decoration-red-300 hover:decoration-red-600"
                        title={item.src}
                      >
                        {item.src}
                      </a>
                    ) : (
                      <div key={i} className="truncate break-all" title={item.src}>
                        {item.src}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {allGood && (
          <div className="rounded-md bg-green-50 border border-green-200 p-3 text-sm text-green-900">
            Lighthouse says all your images have alt text and are reasonably sized. Nice.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============ SCHEMA CARD ============

export function SchemaCard({
  schema,
  aiVerdict,
}: {
  schema: SchemaAnalysis;
  aiVerdict?: AIAnalysis['schema_verdict'];
}) {
  const types = Array.isArray(schema?.types) ? schema.types : [];
  const recommendedMissing = Array.isArray(schema?.recommended_missing)
    ? schema.recommended_missing
    : [];
  void aiVerdict;
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-muted-foreground" />
            <h4 className="font-semibold">Schema Markup</h4>
          </div>
          {schema?.present ? (
            <div className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
              <CheckCircle2 className="h-4 w-4" />
              Found
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-amber-600 font-medium">
              <AlertTriangle className="h-4 w-4" />
              Missing
            </div>
          )}
        </div>

        {schema?.present ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Types detected on your homepage:</p>
            <div className="flex flex-wrap gap-1.5">
              {types.map((t, i) => (
                <Badge key={i} variant="secondary" className="font-mono text-xs">
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No JSON-LD schema detected. Schema unlocks rich results in Google: FAQ, Local Business, Service, Breadcrumb, and more.
          </p>
        )}

        {recommendedMissing.length > 0 && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
              Recommended to add
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recommendedMissing.map((t, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className="border-dashed font-mono text-xs text-amber-700"
                >
                  {t}
                </Badge>
              ))}
            </div>
          </div>
        )}

        <HowToFix
          text={
            recommendedMissing.length > 0
              ? `Add ${recommendedMissing.join(', ')} schema to your homepage. Validate at search.google.com/test/rich-results.`
              : schema?.present
                ? 'Your schema coverage looks good. Keep it up to date as you add new services or pages.'
                : 'Start with LocalBusiness (name, address, phone, hours) and Service for each service page. Validate at search.google.com/test/rich-results.'
          }
        />
      </CardContent>
    </Card>
  );
}

// ============ PERF BREAKDOWN ============

export function PerfBreakdownCard({ perf }: { perf: PerfBreakdown }) {
  const items: { label: string; value: string; description: string; icon: React.ComponentType<{ className?: string }>; color: string }[] = [];

  if (perf.images.present) {
    items.push({
      label: 'Image weight',
      value: formatBytes(perf.images.savings_bytes),
      description: `Your images are too heavy. Converting to WebP saves ${formatBytes(perf.images.savings_bytes)}.`,
      icon: ImageIcon,
      color: 'text-amber-600',
    });
  }
  if (perf.javascript.present) {
    items.push({
      label: 'Unused JavaScript',
      value: formatBytes(perf.javascript.unused_bytes),
      description: `You ship ${formatBytes(perf.javascript.unused_bytes)} of JavaScript the page never runs. Disable unused plugins or remove libraries you don't use.`,
      icon: FileCode2,
      color: 'text-orange-600',
    });
  }
  if (perf.render_blocking.present) {
    items.push({
      label: 'Render-blocking',
      value: `${perf.render_blocking.count} files`,
      description: `${perf.render_blocking.count} scripts or stylesheets are blocking your page from showing. Defer or async them.`,
      icon: Gauge,
      color: 'text-red-600',
    });
  }

  if (items.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Gauge className="h-5 w-5 text-muted-foreground" />
          <h4 className="font-semibold">What's slowing your site down</h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <div key={i} className="rounded-md border bg-muted/20 p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`h-4 w-4 ${item.color}`} />
                  <span className="text-xs text-muted-foreground">{item.label}</span>
                </div>
                <div className={`text-xl font-bold tabular-nums ${item.color}`}>
                  {item.value}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed mt-1.5">
                  {item.description}
                </p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

// ============ SHARED: HowToFix sub-section ============

export function HowToFix({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="rounded-md border border-border/60 bg-muted/40 p-3.5">
      <div className="flex items-center gap-1.5 mb-1.5">
        <Wrench className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">
          How to fix
        </span>
      </div>
      <p className="text-sm leading-relaxed text-foreground/90">{text}</p>
    </div>
  );
}

// ============ SHARED: SuggestedRewrite with copy button ============

export function SuggestedRewrite({
  text,
  label = 'Suggested rewrite',
  hint,
}: {
  text: string;
  label?: string;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  // Detect "already strong" style responses — don't offer a copy button.
  const isAffirmative = /already\s+(strong|good|fine)|looks\s+good/i.test(text);
  return (
    <div className="rounded-md border border-primary/30 bg-primary/[0.04] p-3.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold uppercase tracking-wider text-primary">
            {label}
          </span>
        </div>
        {!isAffirmative && (
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              } catch {
                /* ignore */
              }
            }}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            {copied ? (
              <>
                <Check className="h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" />
                Copy
              </>
            )}
          </button>
        )}
      </div>
      <p className="text-sm leading-relaxed font-medium">{text}</p>
      {hint && <p className="text-[11px] text-muted-foreground mt-1.5">{hint}</p>}
    </div>
  );
}

// ============ SHARED: SourceBadge ============

export function SourceBadge({
  source,
}: {
  source: 'meta_tag' | 'google_snippet' | 'h1_fallback' | null;
}) {
  if (!source || source === 'meta_tag') return null;
  const label =
    source === 'google_snippet' ? 'From Google SERP' : 'Fallback: page H1';
  const hint =
    source === 'google_snippet'
      ? 'We read this from Google search results — the real tag may still be missing.'
      : 'We could not read the real tag — this is your H1 instead.';
  return (
    <div className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground" title={hint}>
      <Info className="h-3 w-3" />
      {label}
    </div>
  );
}

// ============ TOP-LEVEL DASHBOARD WRAPPER ============

export function SEODashboard({
  seo,
  ai,
}: {
  seo: StructuredSEO;
  ai: AIAnalysis | null;
}) {
  // Guard against malformed / partial seo_analysis blobs. Each sub-section
  // is optional-rendered based on whether its expected shape is present.
  if (!seo || typeof seo !== 'object') {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted-foreground">
          Audit data is incomplete. Run a fresh audit to see the full report.
        </CardContent>
      </Card>
    );
  }

  const sources = seo.data_sources;
  const botBlocked = !!sources?.bot_protection_detected;

  return (
    <div className="space-y-6">
      {/* 0. Bot protection banner */}
      {botBlocked && (
        <Card className="border-amber-500/40 bg-amber-50/50">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-amber-900">
                Your site is behind bot protection
              </p>
              <p className="text-xs text-amber-800 leading-relaxed mt-1">
                Your hosting firewall (SiteGround, Cloudflare, or similar) blocked our
                crawler from reading your raw HTML. The speed metrics below come from
                Google's PageSpeed engine (allowed through), and the title / meta
                description come from Google's own search index. Headings and schema
                may be limited — if you want a full audit, temporarily whitelist
                crawlers in your hosting firewall.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 1. Loading speed hero */}
      {seo.loading && <LoadingSpeedHero loading={seo.loading} />}

      {/* 2. AI Summary (if available) */}
      {ai && <AISummaryCard ai={ai} />}

      {/* 3. Performance breakdown — only if there are real findings */}
      {seo.perf && <PerfBreakdownCard perf={seo.perf} />}

      {/* 3b. Keyword coverage — shows primary + LSI coverage against real headings */}
      {seo.keyword_coverage && <KeywordCoverageCard coverage={seo.keyword_coverage} />}

      {/* 4. On-page SEO grid */}
      {(seo.title || seo.meta_description || seo.headings || seo.images || seo.schema) && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              On-page SEO
            </h3>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {seo.title && <TitleCard title={seo.title} aiVerdict={ai?.title_verdict} />}
            {seo.meta_description && (
              <MetaDescriptionCard meta={seo.meta_description} aiVerdict={ai?.meta_verdict} />
            )}
            {seo.headings && (
              <HeadingsCard headings={seo.headings} aiVerdict={ai?.headings_verdict} />
            )}
            {seo.images && <ImagesCard images={seo.images} />}
            {seo.schema && (
              <div className="md:col-span-2">
                <SchemaCard schema={seo.schema} aiVerdict={ai?.schema_verdict} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

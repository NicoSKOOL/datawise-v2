import { forwardRef, useState } from 'react';
import { AlertTriangle, AlertCircle, Info, Zap, Wrench, ExternalLink, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { AuditFinding, Severity } from '@/lib/site-audit';
import { MetaRewriteDialog } from './MetaRewriteDialog';
import type { MetaRewriteIssueType } from '@/lib/meta-rewrite';

function codeToRewriteIssue(code: string): MetaRewriteIssueType | null {
  switch (code) {
    case 'missing_title':
    case 'missing_title_tag':
      return 'missing_title';
    case 'title_too_long':
      return 'long_title';
    case 'title_too_short':
      return 'short_title';
    case 'duplicate_titles':
    case 'duplicate_title':
      return 'duplicate_title';
    case 'missing_meta_description':
    case 'missing_description':
      return 'missing_desc';
    case 'meta_description_too_long':
    case 'description_too_long':
      return 'long_desc';
    case 'meta_description_too_short':
    case 'description_too_short':
      return 'short_desc';
    default:
      return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)}MB`;
  return `${Math.round(bytes / 1000)}KB`;
}

function fileName(u: string): string {
  try {
    const parsed = new URL(u);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || parsed.hostname;
  } catch {
    return u;
  }
}

interface SeverityStyle {
  label: string;
  border: string;
  tint: string;
  chip: string;
  iconColor: string;
  icon: React.ComponentType<{ className?: string }>;
}

const SEVERITY: Record<Severity, SeverityStyle> = {
  critical: {
    label: 'Critical',
    border: 'border-l-red-500',
    tint: 'bg-red-500/[0.02]',
    chip: 'bg-red-500/10 text-red-600 border-red-500/30',
    iconColor: 'text-red-600',
    icon: Zap,
  },
  high: {
    label: 'High',
    border: 'border-l-orange-500',
    tint: 'bg-orange-500/[0.02]',
    chip: 'bg-orange-500/10 text-orange-600 border-orange-500/30',
    iconColor: 'text-orange-600',
    icon: AlertTriangle,
  },
  medium: {
    label: 'Medium',
    border: 'border-l-amber-500',
    tint: 'bg-amber-500/[0.02]',
    chip: 'bg-amber-500/10 text-amber-600 border-amber-500/30',
    iconColor: 'text-amber-600',
    icon: AlertCircle,
  },
  low: {
    label: 'Low',
    border: 'border-l-blue-500',
    tint: 'bg-blue-500/[0.02]',
    chip: 'bg-blue-500/10 text-blue-600 border-blue-500/30',
    iconColor: 'text-blue-600',
    icon: Info,
  },
};

interface Props {
  finding: AuditFinding;
}

export const FindingRow = forwardRef<HTMLDivElement, Props>(function FindingRow({ finding }, ref) {
  const style = SEVERITY[finding.severity];
  const Icon = style.icon;
  const howToFix = finding.evidence?.how_to_fix;
  const displayValue = finding.evidence?.display_value;
  const impact = finding.evidence?.impact;
  const items = finding.evidence?.items || [];
  const [itemsOpen, setItemsOpen] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const rewriteIssue = codeToRewriteIssue(finding.code);
  const canRewrite = !!rewriteIssue && !!finding.page_url;

  return (
    <div
      ref={ref}
      id={`finding-${finding.id}`}
      className={`rounded-lg border border-l-4 ${style.border} ${style.tint} bg-card shadow-sm overflow-hidden scroll-mt-20`}
    >
      <div className="p-5 space-y-3">
        {/* Top row: badges (left) + metric (right) */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${style.chip}`}
            >
              <Icon className="h-3 w-3" />
              {style.label}
            </span>
            <Badge variant="outline" className="text-xs capitalize">
              {finding.category.replace('_', ' ')}
            </Badge>
            {impact === 'quick_win' && (
              <Badge
                variant="outline"
                className="text-xs border-emerald-500/40 text-emerald-600 bg-emerald-500/5"
              >
                Quick win
              </Badge>
            )}
            {impact === 'high_impact' && (
              <Badge
                variant="outline"
                className="text-xs border-violet-500/40 text-violet-600 bg-violet-500/5"
              >
                High impact
              </Badge>
            )}
          </div>

          {displayValue && (
            <div className="flex-shrink-0 text-right">
              <div className={`font-mono tabular-nums text-lg font-semibold ${style.iconColor}`}>
                {displayValue}
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Measured
              </div>
            </div>
          )}
        </div>

        {/* Title */}
        <h4 className="font-semibold text-base leading-snug">{finding.title}</h4>

        {/* Description */}
        {finding.description && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            {finding.description}
          </p>
        )}

        {/* How to fix — always visible */}
        {howToFix && (
          <div className="rounded-md border border-border/60 bg-muted/40 p-3.5">
            <div className="flex items-center gap-1.5 mb-1.5">
              <Wrench className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-semibold uppercase tracking-wider text-primary">
                How to fix
              </span>
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">{howToFix}</p>
          </div>
        )}

        {/* Per-item list (e.g. individual heavy image URLs) */}
        {items.length > 0 && (
          <div className="rounded-md border border-border/60 bg-background">
            <button
              type="button"
              onClick={() => setItemsOpen((v) => !v)}
              className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-muted/40 transition-colors"
            >
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {itemsOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {items.length} {items.length === 1 ? 'file' : 'files'}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {itemsOpen ? 'Hide list' : 'Show individual files'}
              </span>
            </button>
            {itemsOpen && (
              <ul className="border-t border-border/60 divide-y divide-border/40">
                {items.map((item, idx) => (
                  <li
                    key={`${item.url}-${idx}`}
                    className="flex items-center justify-between gap-3 px-3.5 py-2 text-xs"
                  >
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary hover:underline truncate min-w-0"
                      title={item.url}
                    >
                      <ExternalLink className="h-3 w-3 flex-shrink-0" />
                      <span className="truncate">{fileName(item.url)}</span>
                    </a>
                    <span className="font-mono tabular-nums text-muted-foreground flex-shrink-0">
                      {formatBytes(item.size_bytes)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Page URL + AI rewrite */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {finding.page_url ? (
            <a
              href={finding.page_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors min-w-0"
            >
              <ExternalLink className="h-3 w-3 flex-shrink-0" />
              <span className="truncate max-w-[400px]">{finding.page_url}</span>
            </a>
          ) : (
            <span />
          )}
          {canRewrite && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              onClick={() => setRewriteOpen(true)}
            >
              <Sparkles className="h-3 w-3 mr-1" />
              Rewrite with AI
            </Button>
          )}
        </div>
      </div>

      {canRewrite && finding.page_url && rewriteIssue && (
        <MetaRewriteDialog
          open={rewriteOpen}
          onOpenChange={setRewriteOpen}
          url={finding.page_url}
          currentTitle={null}
          currentDescription={null}
          issueType={rewriteIssue}
          auditId={finding.audit_id}
        />
      )}
    </div>
  );
});

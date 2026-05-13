import {
  Gauge,
  Search,
  Accessibility as A11yIcon,
  ShieldCheck,
  Tag,
  FileCode,
  Image as ImageIcon,
  FileText,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { FindingRow } from './FindingRow';
import type { AuditFinding, Category } from '@/lib/site-audit';

const CATEGORY_META: Record<
  Category,
  { label: string; icon: React.ComponentType<{ className?: string }>; color: string }
> = {
  performance: { label: 'Performance', icon: Gauge, color: 'text-sky-600' },
  seo: { label: 'SEO', icon: Search, color: 'text-emerald-600' },
  accessibility: { label: 'Accessibility', icon: A11yIcon, color: 'text-violet-600' },
  best_practices: { label: 'Best Practices', icon: ShieldCheck, color: 'text-indigo-600' },
  meta: { label: 'Meta & Tags', icon: Tag, color: 'text-pink-600' },
  images: { label: 'Images', icon: ImageIcon, color: 'text-amber-600' },
  content: { label: 'Content', icon: FileText, color: 'text-teal-600' },
  technical: { label: 'Technical', icon: FileCode, color: 'text-slate-600' },
};

interface Props {
  category: Category;
  findings: AuditFinding[];
  categoryScore?: number | null;
}

export function CategorySection({ category, findings, categoryScore }: Props) {
  const meta = CATEGORY_META[category];
  const Icon = meta.icon;

  if (findings.length === 0) return null;

  const scoreColor =
    categoryScore == null
      ? 'text-muted-foreground'
      : categoryScore >= 90
        ? 'text-green-600'
        : categoryScore >= 70
          ? 'text-green-500'
          : categoryScore >= 50
            ? 'text-amber-600'
            : 'text-red-600';

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 pb-1 border-b border-border/60">
        <div className="flex items-center gap-2">
          <Icon className={`h-5 w-5 ${meta.color}`} />
          <h3 className="text-base font-semibold">{meta.label}</h3>
          <Badge variant="secondary" className="tabular-nums">
            {findings.length}
          </Badge>
        </div>
        {categoryScore != null && (
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-semibold tabular-nums ${scoreColor}`}>
              {categoryScore}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              / 100
            </span>
          </div>
        )}
      </div>

      <div className="space-y-2.5">
        {findings.map((f) => (
          <FindingRow key={f.id} finding={f} />
        ))}
      </div>
    </section>
  );
}

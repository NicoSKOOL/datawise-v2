import type { ReportPayload, ReportSection } from '../types';
import type { LocalPeriodReportData, LocalPeriodKeywordMove } from '@/types/local-seo';

interface Args {
  report: LocalPeriodReportData;
  charts?: {
    geoGridPng?: string | null;
    ratingDistributionPng?: string | null;
  };
}

function pos(p: number | null): string {
  return p == null ? 'Not in pack' : `#${p}`;
}

function moveText(k: LocalPeriodKeywordMove): string {
  if (k.delta == null) return '--';
  if (k.delta === 0) return '0';
  return k.delta > 0 ? `Up ${k.delta}` : `Down ${Math.abs(k.delta)}`;
}

export function buildLocalSEOReport({ report, charts }: Args): ReportPayload {
  const sections: ReportSection[] = [];
  const businessLabel = report.project.business_name || report.project.name;
  const periodLabel = `last ${report.days} days`;

  sections.push({
    type: 'paragraph',
    text: `This report covers how ${businessLabel} performed in Google's local results over the ${periodLabel}: map pack rankings, map visibility around your location, and customer reviews. Deltas compare the start of the period to today.`,
  });

  // --- KPI strip ---
  const inPack = report.keywords.filter(k => k.current_position != null).length;
  const top3 = report.keywords.filter(k => k.current_position != null && k.current_position <= 3).length;
  const kpis: Array<{ label: string; value: string; delta?: string; tone?: 'up' | 'down' | 'neutral' }> = [
    { label: 'Tracked Keywords', value: String(report.keywords.length) },
    { label: 'In Local Pack', value: String(inPack) },
    { label: 'Top 3', value: String(top3) },
  ];
  if (report.reviews) {
    kpis.push({
      label: 'Rating',
      value: report.reviews.rating != null ? report.reviews.rating.toFixed(1) : '--',
      delta: report.reviews.rating != null && report.reviews.rating_previous != null
        ? (report.reviews.rating - report.reviews.rating_previous >= 0 ? '+' : '') +
          (Math.round((report.reviews.rating - report.reviews.rating_previous) * 10) / 10)
        : undefined,
      tone: report.reviews.rating != null && report.reviews.rating_previous != null
        ? (report.reviews.rating >= report.reviews.rating_previous ? 'up' : 'down')
        : 'neutral',
    });
  }
  sections.push({ type: 'kpi-grid', items: kpis });

  // --- Keyword movement ---
  sections.push({ type: 'heading', level: 2, text: 'Local Pack Rankings' });
  if (report.keywords.length === 0) {
    sections.push({ type: 'paragraph', text: 'No keyword checks were recorded in this period. Run a local rank check to start tracking movement.' });
  } else {
    sections.push({
      type: 'paragraph',
      text: `Where ${businessLabel} ranked in the map pack at the start of the period vs today.`,
    });
    sections.push({
      type: 'table',
      headers: ['Keyword', 'Period Start', 'Now', 'Change'],
      rows: report.keywords.map(k => [k.keyword, pos(k.start_position), pos(k.current_position), moveText(k)]),
    });
    if (report.best_movers.length > 0) {
      sections.push({
        type: 'callout',
        tone: 'success',
        text: `Biggest gains: ${report.best_movers.map(k => `"${k.keyword}" (${moveText(k)})`).join(', ')}.`,
      });
    }
    if (report.decliners.length > 0) {
      sections.push({
        type: 'callout',
        tone: 'warn',
        text: `Lost ground: ${report.decliners.map(k => `"${k.keyword}" (${moveText(k)})`).join(', ')}.`,
      });
    }
  }

  // --- Geo-grid ---
  if (report.geogrid) {
    const g = report.geogrid.latest;
    sections.push({ type: 'heading', level: 2, text: 'Map Visibility' });
    sections.push({
      type: 'paragraph',
      text: `Latest scan for "${g.keyword}" (${new Date(g.scanned_at).toLocaleDateString()}): found at ${g.found_count} of ${g.total_points} points, in the top 3 at ${g.top3_count} points${g.avg_position != null ? `, average position ${g.avg_position}` : ''}.` +
        (report.geogrid.previous
          ? ` The previous scan found you at ${report.geogrid.previous.found_count} points with ${report.geogrid.previous.top3_count} in the top 3.`
          : ''),
    });
    if (charts?.geoGridPng) {
      sections.push({ type: 'chart', pngDataUrl: charts.geoGridPng, caption: `Map visibility grid for "${g.keyword}"` });
    }
    if (g.competitors.length > 0) {
      sections.push({ type: 'heading', level: 3, text: 'Who owns your map' });
      sections.push({
        type: 'table',
        headers: ['Business', 'Top 3 Share', 'Avg Position', 'Rating', 'Reviews'],
        rows: g.competitors.map(c => [
          c.is_user ? `${c.name} (you)` : c.name,
          `${c.appearances}/${c.total_points} (${c.total_points > 0 ? Math.round((c.appearances / c.total_points) * 100) : 0}%)`,
          c.avg_position == null ? '--' : `#${c.avg_position}`,
          c.rating == null ? '--' : c.rating,
          c.reviews == null ? '--' : c.reviews,
        ]),
        caption: 'Share of grid points where each business appears in the map top 3',
      });
    }
  }

  // --- Reviews ---
  if (report.reviews) {
    const r = report.reviews;
    sections.push({ type: 'heading', level: 2, text: 'Reviews' });
    const velocityText = r.velocity.current_period != null
      ? `You gained ${r.velocity.current_period} review${r.velocity.current_period === 1 ? '' : 's'} this period` +
        (r.velocity.previous_period != null ? ` (previous period: ${r.velocity.previous_period}).` : '.')
      : 'Not enough history yet to measure review velocity.';
    sections.push({
      type: 'paragraph',
      text: `Your rating is ${r.rating ?? '--'} across ${r.reviews_count ?? '--'} reviews. ${velocityText} ${r.response_rate != null ? `You have responded to ${r.response_rate}% of recent reviews.` : ''}`,
    });
    if ((r.unanswered_low_star ?? 0) > 0) {
      sections.push({
        type: 'callout',
        tone: 'warn',
        text: `${r.unanswered_low_star} review${r.unanswered_low_star === 1 ? '' : 's'} rated 3 stars or below ${r.unanswered_low_star === 1 ? 'has' : 'have'} no owner response yet.`,
      });
    }
    if (charts?.ratingDistributionPng) {
      sections.push({ type: 'chart', pngDataUrl: charts.ratingDistributionPng, caption: 'Rating distribution', widthPct: 60 });
    } else if (r.rating_distribution) {
      sections.push({
        type: 'table',
        headers: ['Stars', 'Reviews'],
        rows: ['5', '4', '3', '2', '1'].map(s => [`${s} stars`, r.rating_distribution?.[s] ?? 0]),
      });
    }
    if (r.themes) {
      sections.push({ type: 'heading', level: 3, text: 'What customers are saying' });
      sections.push({ type: 'paragraph', text: r.themes.summary });
      sections.push({
        type: 'list',
        style: 'bullet',
        items: r.themes.themes.map(t => `${t.theme} (${t.sentiment}, ${t.mention_count} mentions)${t.quotes[0] ? `: "${t.quotes[0]}"` : ''}`),
      });
    }
  }

  // --- GBP completeness ---
  if (report.gbp) {
    sections.push({ type: 'heading', level: 2, text: 'Business Profile Health' });
    sections.push({
      type: 'paragraph',
      text: `Your Google Business Profile is ${report.gbp.completeness_pct}% complete based on the fields we can verify.` +
        (report.gbp.missing.length > 0
          ? ` Missing or unverified: ${report.gbp.missing.join(', ')}.`
          : ' All verifiable fields are complete.'),
    });
  }

  // --- Next steps ---
  if (report.next_steps.length > 0) {
    sections.push({ type: 'heading', level: 2, text: 'Recommended Next Steps' });
    sections.push({
      type: 'list',
      style: 'numbered',
      items: report.next_steps.map(s => `${s.title}: ${s.detail}`),
    });
  }

  const to = new Date();
  const from = new Date(to.getTime() - report.days * 86400000);
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  return {
    title: `Local Performance Report: ${businessLabel}`,
    subtitle: `Last ${report.days} days`,
    domain: report.project.domain ?? undefined,
    dateRange: { from: fmt(from), to: fmt(to) },
    generatedAt: new Date(),
    sections,
  };
}

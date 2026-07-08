import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BRAND_RGB, BRAND_FOOTER, BRAND_NAME, derivePalette } from './brand';
import type { ReportPayload, ReportSection } from './types';
import type { BrandingConfig } from '../branding';

const PAGE = {
  width: 210,
  height: 297,
  marginX: 18,
  marginTop: 22,
  marginBottom: 18,
};

const CONTENT_WIDTH = PAGE.width - PAGE.marginX * 2;

type Rgb = readonly [number, number, number];

// Colors that may be swapped by white-label branding. Everything else keeps
// the BRAND_RGB constants. With no branding this resolves to the exact same
// tuples, so default output is identical to before branding existed.
interface PdfPalette {
  /** Brand text, headings, table header fill. Always dark enough for text. */
  primary: Rgb;
  /** Lighter variant, used for the info callout accent. */
  primaryLight: Rgb;
  /** Decorative top bars. Custom color even when too light for text. */
  bar: Rgb;
}

const DEFAULT_PDF_PALETTE: PdfPalette = {
  primary: BRAND_RGB.primary,
  primaryLight: BRAND_RGB.primaryLight,
  bar: BRAND_RGB.primary,
};

function resolvePdfPalette(branding?: BrandingConfig): PdfPalette {
  if (!branding?.primaryColor) return DEFAULT_PDF_PALETTE;
  const custom = derivePalette(branding.primaryColor);
  if (custom.isLight) {
    // Too light to carry text or table headers: keep the dark defaults and
    // use the custom color only for the accent bars.
    return { ...DEFAULT_PDF_PALETTE, bar: custom.rgb.primary };
  }
  return {
    primary: custom.rgb.primary,
    primaryLight: custom.rgb.primaryLight,
    bar: custom.rgb.primary,
  };
}

interface Ctx {
  doc: jsPDF;
  y: number;
  payload: ReportPayload;
  pal: PdfPalette;
  brandName: string;
  logoDataUrl?: string;
}

export async function renderPdf(payload: ReportPayload, branding?: BrandingConfig): Promise<Blob> {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setFont('helvetica', 'normal');

  const ctx: Ctx = {
    doc,
    y: PAGE.marginTop,
    payload,
    pal: resolvePdfPalette(branding),
    brandName: branding?.brandName || BRAND_NAME,
    logoDataUrl: branding?.logoDataUrl,
  };

  renderCover(ctx);

  for (const section of payload.sections) {
    renderSection(ctx, section);
  }

  decoratePages(doc, payload, ctx.pal, ctx.brandName);

  return doc.output('blob');
}

function renderCoverLogo(ctx: Ctx) {
  if (!ctx.logoDataUrl) return;
  const { doc } = ctx;
  try {
    // Natural aspect ratio from the embedded image, height capped at 14mm.
    const props = doc.getImageProperties(ctx.logoDataUrl);
    if (!props.width || !props.height) return;
    const maxH = 14;
    const maxW = 60;
    let h = maxH;
    let w = (props.width / props.height) * h;
    if (w > maxW) {
      h = h * (maxW / w);
      w = maxW;
    }
    doc.addImage(ctx.logoDataUrl, 'PNG', PAGE.width - PAGE.marginX - w, 6, w, h);
  } catch {
    // A bad logo must never break the export: render without it.
  }
}

function renderCover(ctx: Ctx) {
  const { doc, payload } = ctx;
  doc.setFillColor(...ctx.pal.bar);
  doc.rect(0, 0, PAGE.width, 3, 'F');

  renderCoverLogo(ctx);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...ctx.pal.primary);
  doc.text(ctx.brandName.toUpperCase(), PAGE.marginX, PAGE.marginTop - 6);

  ctx.y = PAGE.marginTop + 2;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...BRAND_RGB.textDark);
  const titleLines = doc.splitTextToSize(payload.title, CONTENT_WIDTH);
  doc.text(titleLines, PAGE.marginX, ctx.y);
  ctx.y += titleLines.length * 8 + 2;

  if (payload.subtitle) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...BRAND_RGB.textMuted);
    const subLines = doc.splitTextToSize(payload.subtitle, CONTENT_WIDTH);
    doc.text(subLines, PAGE.marginX, ctx.y);
    ctx.y += subLines.length * 5;
  }

  if (payload.domain || payload.dateRange) {
    const meta: string[] = [];
    if (payload.domain) meta.push(payload.domain);
    // Plain "to" instead of an arrow: the embedded PDF font cannot encode it.
    if (payload.dateRange) meta.push(`${payload.dateRange.from} to ${payload.dateRange.to}`);
    doc.setFontSize(10);
    doc.setTextColor(...BRAND_RGB.textMuted);
    doc.text(meta.join('  ·  '), PAGE.marginX, ctx.y + 2);
    ctx.y += 6;
  }

  ctx.y += 4;
  doc.setDrawColor(...BRAND_RGB.borderLight);
  doc.setLineWidth(0.3);
  doc.line(PAGE.marginX, ctx.y, PAGE.width - PAGE.marginX, ctx.y);
  ctx.y += 6;
}

function ensureSpace(ctx: Ctx, needed: number) {
  if (ctx.y + needed > PAGE.height - PAGE.marginBottom) {
    ctx.doc.addPage();
    ctx.y = PAGE.marginTop;
  }
}

function renderSection(ctx: Ctx, section: ReportSection) {
  switch (section.type) {
    case 'heading':
      return renderHeading(ctx, section);
    case 'paragraph':
      return renderParagraph(ctx, section.text);
    case 'markdown':
      return renderMarkdown(ctx, section.content);
    case 'kpi-grid':
      return renderKpiGrid(ctx, section.items);
    case 'table':
      return renderTable(ctx, section);
    case 'list':
      return renderList(ctx, section.items, section.style);
    case 'chart':
      return renderChart(ctx, section);
    case 'callout':
      return renderCallout(ctx, section);
    case 'divider':
      return renderDivider(ctx);
  }
}

function renderHeading(ctx: Ctx, section: { level: 1 | 2 | 3; text: string }) {
  const { doc } = ctx;
  const sizes = { 1: 16, 2: 13, 3: 11 } as const;
  const spacingBefore = { 1: 6, 2: 5, 3: 4 } as const;
  const spacingAfter = { 1: 3, 2: 2, 3: 2 } as const;

  ensureSpace(ctx, sizes[section.level] + 6);
  ctx.y += spacingBefore[section.level];

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(sizes[section.level]);
  doc.setTextColor(...ctx.pal.primary);
  const lines = doc.splitTextToSize(section.text, CONTENT_WIDTH);
  doc.text(lines, PAGE.marginX, ctx.y);
  ctx.y += lines.length * (sizes[section.level] * 0.42) + spacingAfter[section.level];
}

function renderParagraph(ctx: Ctx, text: string) {
  const { doc } = ctx;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_RGB.textDark);
  const lines = doc.splitTextToSize(text, CONTENT_WIDTH);
  for (const line of lines) {
    ensureSpace(ctx, 5);
    doc.text(line, PAGE.marginX, ctx.y);
    ctx.y += 4.6;
  }
  ctx.y += 1.5;
}

function renderList(ctx: Ctx, items: string[], style: 'bullet' | 'numbered') {
  const { doc } = ctx;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...BRAND_RGB.textDark);
  items.forEach((item, i) => {
    const prefix = style === 'numbered' ? `${i + 1}. ` : '• ';
    const lines = doc.splitTextToSize(prefix + item, CONTENT_WIDTH - 4);
    ensureSpace(ctx, lines.length * 5);
    doc.text(lines, PAGE.marginX + 2, ctx.y);
    ctx.y += lines.length * 4.6 + 0.5;
  });
  ctx.y += 1.5;
}

function renderKpiGrid(
  ctx: Ctx,
  items: Array<{ label: string; value: string; delta?: string; tone?: 'up' | 'down' | 'neutral' }>
) {
  if (!items.length) return;
  const { doc } = ctx;
  const perRow = items.length <= 3 ? items.length : items.length === 4 ? 2 : 3;
  const gap = 3;
  const cardW = (CONTENT_WIDTH - gap * (perRow - 1)) / perRow;
  const cardH = 20;

  for (let i = 0; i < items.length; i += perRow) {
    const rowItems = items.slice(i, i + perRow);
    ensureSpace(ctx, cardH + 2);
    rowItems.forEach((item, j) => {
      const x = PAGE.marginX + j * (cardW + gap);
      const y = ctx.y;
      doc.setFillColor(...BRAND_RGB.bgMuted);
      doc.setDrawColor(...BRAND_RGB.borderLight);
      doc.roundedRect(x, y, cardW, cardH, 1.5, 1.5, 'FD');

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...BRAND_RGB.textMuted);
      doc.text(item.label.toUpperCase(), x + 3, y + 5);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(14);
      doc.setTextColor(...BRAND_RGB.textDark);
      const valueLines = doc.splitTextToSize(item.value, cardW - 6);
      doc.text(valueLines[0] ?? '', x + 3, y + 12);

      if (item.delta) {
        const toneColor =
          item.tone === 'up'
            ? BRAND_RGB.accentUp
            : item.tone === 'down'
              ? BRAND_RGB.accentDown
              : BRAND_RGB.textMuted;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...toneColor);
        doc.text(item.delta, x + 3, y + 17);
      }
    });
    ctx.y += cardH + gap;
  }
  ctx.y += 1;
}

function renderTable(
  ctx: Ctx,
  section: {
    headers: string[];
    rows: Array<Array<string | number>>;
    caption?: string;
    colWidthsPct?: number[];
  }
) {
  if (section.caption) {
    const { doc } = ctx;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor(...BRAND_RGB.textMuted);
    ensureSpace(ctx, 6);
    doc.text(section.caption, PAGE.marginX, ctx.y);
    ctx.y += 4;
  }
  ensureSpace(ctx, 20);
  // Explicit widths (percent of content width) stop autotable from letting a
  // long text column starve short ones (bug 1a856da2: Severity/Issue in the
  // Site Audit export were squeezed to unreadable slivers by "How to Fix").
  const columnStyles = section.colWidthsPct
    ? Object.fromEntries(
        section.colWidthsPct.map((pct, i) => [i, { cellWidth: (CONTENT_WIDTH * pct) / 100 }])
      )
    : undefined;
  autoTable(ctx.doc, {
    startY: ctx.y,
    head: [section.headers],
    body: section.rows.map((r) => r.map((cell) => (cell ?? '').toString())),
    margin: { left: PAGE.marginX, right: PAGE.marginX },
    styles: { fontSize: 9, cellPadding: 2, textColor: BRAND_RGB.textDark },
    columnStyles,
    headStyles: {
      fillColor: [...ctx.pal.primary],
      textColor: BRAND_RGB.white,
      fontStyle: 'bold',
    },
    alternateRowStyles: { fillColor: BRAND_RGB.bgMuted },
    theme: 'grid',
  });
  // @ts-expect-error autotable attaches lastAutoTable at runtime
  ctx.y = (ctx.doc.lastAutoTable?.finalY ?? ctx.y) + 4;
}

function renderChart(
  ctx: Ctx,
  section: { pngDataUrl: string; caption?: string; widthPct?: number }
) {
  const { doc } = ctx;
  const widthPct = section.widthPct ?? 100;
  const width = (CONTENT_WIDTH * widthPct) / 100;

  const imgProps = doc.getImageProperties(section.pngDataUrl);
  const ratio = imgProps.height / imgProps.width;
  const height = Math.min(width * ratio, 110);
  const finalWidth = height >= 110 ? 110 / ratio : width;

  ensureSpace(ctx, height + (section.caption ? 6 : 2));
  const x = PAGE.marginX + (CONTENT_WIDTH - finalWidth) / 2;
  doc.addImage(section.pngDataUrl, 'PNG', x, ctx.y, finalWidth, height);
  ctx.y += height + 2;

  if (section.caption) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8);
    doc.setTextColor(...BRAND_RGB.textMuted);
    doc.text(section.caption, PAGE.width / 2, ctx.y, { align: 'center' });
    ctx.y += 4;
  }
  ctx.y += 2;
}

function renderCallout(
  ctx: Ctx,
  section: { tone: 'info' | 'warn' | 'success'; text: string }
) {
  const { doc } = ctx;
  const tones = {
    info: ctx.pal.primaryLight,
    warn: BRAND_RGB.accentDown,
    success: BRAND_RGB.accentUp,
  };
  const color = tones[section.tone];
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(section.text, CONTENT_WIDTH - 8);
  const boxH = lines.length * 4.6 + 5;
  ensureSpace(ctx, boxH + 2);
  doc.setDrawColor(...color);
  doc.setFillColor(...BRAND_RGB.bgMuted);
  doc.setLineWidth(0.8);
  doc.roundedRect(PAGE.marginX, ctx.y, CONTENT_WIDTH, boxH, 1, 1, 'FD');
  doc.setLineWidth(1.5);
  doc.line(PAGE.marginX, ctx.y, PAGE.marginX, ctx.y + boxH);
  doc.setTextColor(...BRAND_RGB.textDark);
  doc.text(lines, PAGE.marginX + 4, ctx.y + 4.5);
  ctx.y += boxH + 3;
}

function renderDivider(ctx: Ctx) {
  ensureSpace(ctx, 6);
  ctx.doc.setDrawColor(...BRAND_RGB.borderLight);
  ctx.doc.setLineWidth(0.3);
  ctx.doc.line(PAGE.marginX, ctx.y + 2, PAGE.width - PAGE.marginX, ctx.y + 2);
  ctx.y += 6;
}

// Tiny markdown walker: handles headings, paragraphs, bullet/numbered lists,
// bold (**text**), inline code (`code`), and code fences. Not a full parser —
// scoped to what the SEO Assistant and Content Revival actually produce.
function renderMarkdown(ctx: Ctx, markdown: string) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  let inFence = false;
  let fenceBuf: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inFence) {
        renderCodeBlock(ctx, fenceBuf.join('\n'));
        fenceBuf = [];
        inFence = false;
      } else {
        inFence = true;
      }
      i++;
      continue;
    }
    if (inFence) {
      fenceBuf.push(line);
      i++;
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = (Math.min(h[1].length, 3) as 1 | 2 | 3);
      renderHeading(ctx, { level, text: h[2] });
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ''));
        i++;
      }
      renderList(ctx, items.map(stripInlineMd), 'bullet');
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      renderList(ctx, items.map(stripInlineMd), 'numbered');
      continue;
    }

    if (line.trim() === '') {
      ctx.y += 2;
      i++;
      continue;
    }

    // Table detection (pipe tables) — consume and emit as table section
    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i++;
      }
      renderTable(ctx, { headers, rows });
      continue;
    }

    renderParagraph(ctx, stripInlineMd(line));
    i++;
  }

  if (inFence && fenceBuf.length) renderCodeBlock(ctx, fenceBuf.join('\n'));
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => stripInlineMd(c.trim()));
}

function stripInlineMd(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
}

function renderCodeBlock(ctx: Ctx, code: string) {
  const { doc } = ctx;
  doc.setFont('courier', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...BRAND_RGB.textDark);
  const lines = code.split('\n');
  const boxH = lines.length * 4 + 4;
  ensureSpace(ctx, boxH + 2);
  doc.setFillColor(...BRAND_RGB.bgMuted);
  doc.setDrawColor(...BRAND_RGB.borderLight);
  doc.roundedRect(PAGE.marginX, ctx.y, CONTENT_WIDTH, boxH, 1, 1, 'FD');
  lines.forEach((ln, idx) => {
    doc.text(ln, PAGE.marginX + 3, ctx.y + 4 + idx * 4);
  });
  ctx.y += boxH + 2;
  doc.setFont('helvetica', 'normal');
}

function decoratePages(doc: jsPDF, payload: ReportPayload, pal: PdfPalette, brandName: string) {
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    // Top brand bar on every page except cover
    if (p > 1) {
      doc.setFillColor(...pal.bar);
      doc.rect(0, 0, PAGE.width, 3, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(...pal.primary);
      doc.text(brandName.toUpperCase(), PAGE.marginX, 10);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...BRAND_RGB.textMuted);
      const titleShort = payload.title.length > 60 ? payload.title.slice(0, 57) + '…' : payload.title;
      doc.text(titleShort, PAGE.width - PAGE.marginX, 10, { align: 'right' });
    }
    // Footer
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...BRAND_RGB.textMuted);
    doc.text(BRAND_FOOTER(payload.generatedAt), PAGE.marginX, PAGE.height - 8);
    doc.text(`${p} / ${pageCount}`, PAGE.width - PAGE.marginX, PAGE.height - 8, { align: 'right' });
  }
}

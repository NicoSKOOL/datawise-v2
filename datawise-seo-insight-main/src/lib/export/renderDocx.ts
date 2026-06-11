import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  WidthType,
  AlignmentType,
  BorderStyle,
  ShadingType,
  ImageRun,
  Footer,
  Header,
  PageNumber,
  LevelFormat,
  type ISectionOptions,
} from 'docx';
import { BRAND, BRAND_FOOTER, BRAND_NAME, derivePalette } from './brand';
import type { ReportPayload, ReportSection } from './types';
import type { BrandingConfig } from '../branding';

const HEX = {
  primary: BRAND.primary.replace('#', ''),
  primaryLight: BRAND.primaryLight.replace('#', ''),
  textDark: BRAND.textDark.replace('#', ''),
  textMuted: BRAND.textMuted.replace('#', ''),
  bgMuted: BRAND.bgMuted.replace('#', ''),
  borderLight: BRAND.borderLight.replace('#', ''),
  accentUp: BRAND.accentUp.replace('#', ''),
  accentDown: BRAND.accentDown.replace('#', ''),
  accentNeutral: BRAND.accentNeutral.replace('#', ''),
};

// Colors that may be swapped by white-label branding. Everything else keeps
// the HEX constants. With no branding this resolves to the exact same values,
// so default output is identical to before branding existed.
interface DocxPalette {
  primary: string;
  primaryLight: string;
}

const DEFAULT_DOCX_PALETTE: DocxPalette = {
  primary: HEX.primary,
  primaryLight: HEX.primaryLight,
};

function resolveDocxPalette(branding?: BrandingConfig): DocxPalette {
  if (!branding?.primaryColor) return DEFAULT_DOCX_PALETTE;
  const custom = derivePalette(branding.primaryColor);
  // Too light to carry text or table headers: keep the dark defaults.
  if (custom.isLight) return DEFAULT_DOCX_PALETTE;
  return {
    primary: custom.hex.primary.replace('#', ''),
    primaryLight: custom.hex.primaryLight.replace('#', ''),
  };
}

// Parse width/height from a PNG's IHDR chunk (bytes 16-23 after the
// signature). The logo data URL is normalized to PNG before it reaches the
// renderer, so this is enough to preserve the natural aspect ratio.
function pngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47];
  for (let i = 0; i < 4; i++) {
    if (bytes[i] !== sig[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (!width || !height) return null;
  return { width, height };
}

// 14mm at 96dpi, matching the PDF cover logo cap.
const LOGO_MAX_HEIGHT_PX = 53;
const LOGO_MAX_WIDTH_PX = 220;

function coverLogoParagraph(logoDataUrl?: string): Paragraph | null {
  if (!logoDataUrl) return null;
  try {
    const base64 = logoDataUrl.split(',')[1] ?? '';
    if (!base64) return null;
    const bytes = base64ToUint8Array(base64);
    const dims = pngDimensions(bytes);
    if (!dims) return null;
    let height = LOGO_MAX_HEIGHT_PX;
    let width = Math.round((dims.width / dims.height) * height);
    if (width > LOGO_MAX_WIDTH_PX) {
      height = Math.round(height * (LOGO_MAX_WIDTH_PX / width));
      width = LOGO_MAX_WIDTH_PX;
    }
    return new Paragraph({
      children: [
        new ImageRun({
          type: 'png',
          data: bytes,
          transformation: { width, height },
        }),
      ],
      spacing: { after: 120 },
    });
  } catch {
    // A bad logo must never break the export: render without it.
    return null;
  }
}

export async function renderDocx(payload: ReportPayload, branding?: BrandingConfig): Promise<Blob> {
  const pal = resolveDocxPalette(branding);
  const brandName = branding?.brandName || BRAND_NAME;
  const children: ISectionOptions['children'] = [];

  // Cover block
  const logoParagraph = coverLogoParagraph(branding?.logoDataUrl);
  if (logoParagraph) children.push(logoParagraph);
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: brandName.toUpperCase(),
          bold: true,
          size: 20,
          color: pal.primary,
        }),
      ],
      spacing: { after: 120 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: payload.title, bold: true, size: 44, color: HEX.textDark }),
      ],
      spacing: { after: 160 },
    })
  );

  if (payload.subtitle) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: payload.subtitle, size: 22, color: HEX.textMuted })],
        spacing: { after: 120 },
      })
    );
  }

  const metaParts: string[] = [];
  if (payload.domain) metaParts.push(payload.domain);
  if (payload.dateRange) metaParts.push(`${payload.dateRange.from} → ${payload.dateRange.to}`);
  if (metaParts.length) {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: metaParts.join('  ·  '), size: 20, color: HEX.textMuted }),
        ],
        spacing: { after: 240 },
      })
    );
  }

  children.push(dividerParagraph());

  for (const section of payload.sections) {
    const nodes = renderSection(section, pal);
    children.push(...nodes);
  }

  const doc = new Document({
    creator: BRAND_NAME,
    title: payload.title,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 22, color: HEX.textDark },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: 'numbered-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 360, hanging: 260 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: truncate(payload.title, 80),
                    size: 16,
                    color: HEX.textMuted,
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.LEFT,
                children: [
                  new TextRun({
                    text: BRAND_FOOTER(payload.generatedAt),
                    size: 16,
                    color: HEX.textMuted,
                  }),
                  new TextRun({ text: '    ', size: 16 }),
                  new TextRun({
                    children: ['Page ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES],
                    size: 16,
                    color: HEX.textMuted,
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  return blob;
}

function renderSection(
  section: ReportSection,
  pal: DocxPalette = DEFAULT_DOCX_PALETTE
): Array<Paragraph | Table> {
  switch (section.type) {
    case 'heading':
      return [headingParagraph(section.level, section.text, pal)];
    case 'paragraph':
      return [
        new Paragraph({
          children: [new TextRun({ text: section.text, size: 22, color: HEX.textDark })],
          spacing: { after: 120 },
        }),
      ];
    case 'markdown':
      return renderMarkdown(section.content, pal);
    case 'kpi-grid':
      return [renderKpiTable(section.items)];
    case 'table':
      return renderTableSection(section, pal);
    case 'list':
      return section.items.map((item) =>
        new Paragraph({
          children: [new TextRun({ text: item, size: 22, color: HEX.textDark })],
          bullet: section.style === 'bullet' ? { level: 0 } : undefined,
          numbering:
            section.style === 'numbered'
              ? { reference: 'numbered-list', level: 0 }
              : undefined,
          spacing: { after: 60 },
        })
      );
    case 'chart':
      return renderChartParagraphs(section);
    case 'callout':
      return [renderCallout(section, pal)];
    case 'divider':
      return [dividerParagraph()];
  }
}

function headingParagraph(
  level: 1 | 2 | 3,
  text: string,
  pal: DocxPalette = DEFAULT_DOCX_PALETTE
): Paragraph {
  const sizes = { 1: 32, 2: 26, 3: 22 } as const;
  const headingLevel =
    level === 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
  return new Paragraph({
    heading: headingLevel,
    children: [
      new TextRun({ text, bold: true, size: sizes[level], color: pal.primary }),
    ],
    spacing: { before: 200, after: 120 },
  });
}

function renderKpiTable(
  items: Array<{ label: string; value: string; delta?: string; tone?: 'up' | 'down' | 'neutral' }>
): Table {
  const perRow = items.length <= 3 ? items.length : items.length === 4 ? 2 : 3;
  const rows: TableRow[] = [];
  for (let i = 0; i < items.length; i += perRow) {
    const rowItems = items.slice(i, i + perRow);
    while (rowItems.length < perRow) rowItems.push({ label: '', value: '' });
    rows.push(
      new TableRow({
        children: rowItems.map(
          (item) =>
            new TableCell({
              width: { size: Math.floor(10000 / perRow), type: WidthType.DXA },
              shading: { type: ShadingType.SOLID, color: HEX.bgMuted, fill: HEX.bgMuted },
              margins: { top: 120, bottom: 120, left: 140, right: 140 },
              borders: uniformBorder(HEX.borderLight),
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: item.label.toUpperCase(),
                      size: 14,
                      color: HEX.textMuted,
                      bold: true,
                    }),
                  ],
                  spacing: { after: 40 },
                }),
                new Paragraph({
                  children: [
                    new TextRun({ text: item.value, size: 28, bold: true, color: HEX.textDark }),
                  ],
                  spacing: { after: item.delta ? 40 : 0 },
                }),
                ...(item.delta
                  ? [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: item.delta,
                            size: 16,
                            color:
                              item.tone === 'up'
                                ? HEX.accentUp
                                : item.tone === 'down'
                                  ? HEX.accentDown
                                  : HEX.textMuted,
                          }),
                        ],
                      }),
                    ]
                  : []),
              ],
            })
        ),
      })
    );
  }
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

function renderTableSection(
  section: {
    headers: string[];
    rows: Array<Array<string | number>>;
    caption?: string;
  },
  pal: DocxPalette = DEFAULT_DOCX_PALETTE
): Array<Paragraph | Table> {
  const out: Array<Paragraph | Table> = [];
  if (section.caption) {
    out.push(
      new Paragraph({
        children: [new TextRun({ text: section.caption, italics: true, size: 18, color: HEX.textMuted })],
        spacing: { after: 80 },
      })
    );
  }
  const headerRow = new TableRow({
    tableHeader: true,
    children: section.headers.map(
      (h) =>
        new TableCell({
          shading: { type: ShadingType.SOLID, color: pal.primary, fill: pal.primary },
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
          borders: uniformBorder(pal.primary),
          children: [
            new Paragraph({
              children: [new TextRun({ text: h, bold: true, size: 20, color: 'FFFFFF' })],
            }),
          ],
        })
    ),
  });
  const bodyRows = section.rows.map(
    (row, rowIdx) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              shading:
                rowIdx % 2 === 1
                  ? { type: ShadingType.SOLID, color: HEX.bgMuted, fill: HEX.bgMuted }
                  : undefined,
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              borders: uniformBorder(HEX.borderLight),
              children: [
                new Paragraph({
                  children: [
                    new TextRun({ text: String(cell ?? ''), size: 18, color: HEX.textDark }),
                  ],
                }),
              ],
            })
        ),
      })
  );
  out.push(
    new Table({
      rows: [headerRow, ...bodyRows],
      width: { size: 100, type: WidthType.PERCENTAGE },
    })
  );
  out.push(new Paragraph({ children: [new TextRun({ text: '', size: 8 })], spacing: { after: 120 } }));
  return out;
}

function renderChartParagraphs(section: {
  pngDataUrl: string;
  caption?: string;
  widthPct?: number;
}): Paragraph[] {
  const out: Paragraph[] = [];
  const base64 = section.pngDataUrl.split(',')[1] ?? '';
  const bytes = base64ToUint8Array(base64);
  const widthPt = Math.round(500 * ((section.widthPct ?? 100) / 100));
  out.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          type: 'png',
          data: bytes,
          transformation: { width: widthPt, height: Math.round(widthPt * 0.55) },
        }),
      ],
      spacing: { before: 120, after: 80 },
    })
  );
  if (section.caption) {
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: section.caption, italics: true, size: 16, color: HEX.textMuted })],
        spacing: { after: 120 },
      })
    );
  }
  return out;
}

function renderCallout(
  section: { tone: 'info' | 'warn' | 'success'; text: string },
  pal: DocxPalette = DEFAULT_DOCX_PALETTE
): Table {
  const toneColor =
    section.tone === 'warn'
      ? HEX.accentDown
      : section.tone === 'success'
        ? HEX.accentUp
        : pal.primaryLight;
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.SOLID, color: HEX.bgMuted, fill: HEX.bgMuted },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: HEX.borderLight },
              right: { style: BorderStyle.SINGLE, size: 4, color: HEX.borderLight },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: HEX.borderLight },
              left: { style: BorderStyle.SINGLE, size: 24, color: toneColor },
            },
            margins: { top: 160, bottom: 160, left: 200, right: 200 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: section.text, size: 22, color: HEX.textDark })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function dividerParagraph(): Paragraph {
  return new Paragraph({
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 6, color: HEX.borderLight, space: 6 },
    },
    spacing: { before: 120, after: 120 },
    children: [],
  });
}

function uniformBorder(color: string) {
  const edge = { style: BorderStyle.SINGLE, size: 4, color };
  return { top: edge, bottom: edge, left: edge, right: edge };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Minimal markdown walker mirroring the PDF renderer's behavior.
function renderMarkdown(
  markdown: string,
  pal: DocxPalette = DEFAULT_DOCX_PALETTE
): Array<Paragraph | Table> {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out: Array<Paragraph | Table> = [];
  let i = 0;
  let inFence = false;
  let fenceBuf: string[] = [];

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (inFence) {
        out.push(codeBlockParagraph(fenceBuf.join('\n')));
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
      const level = Math.min(h[1].length, 3) as 1 | 2 | 3;
      out.push(headingParagraph(level, h[2], pal));
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        out.push(
          new Paragraph({
            bullet: { level: 0 },
            children: [
              new TextRun({
                text: stripInlineMd(lines[i].replace(/^\s*[-*]\s+/, '')),
                size: 22,
                color: HEX.textDark,
              }),
            ],
            spacing: { after: 40 },
          })
        );
        i++;
      }
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        out.push(
          new Paragraph({
            numbering: { reference: 'numbered-list', level: 0 },
            children: [
              new TextRun({
                text: stripInlineMd(lines[i].replace(/^\s*\d+\.\s+/, '')),
                size: 22,
                color: HEX.textDark,
              }),
            ],
            spacing: { after: 40 },
          })
        );
        i++;
      }
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1])) {
      const headers = splitRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(...renderTableSection({ headers, rows }, pal));
      continue;
    }

    out.push(
      new Paragraph({
        children: [new TextRun({ text: stripInlineMd(line), size: 22, color: HEX.textDark })],
        spacing: { after: 80 },
      })
    );
    i++;
  }

  return out;
}

function codeBlockParagraph(code: string): Paragraph {
  return new Paragraph({
    shading: { type: ShadingType.SOLID, color: HEX.bgMuted, fill: HEX.bgMuted },
    children: code.split('\n').map(
      (line, idx) =>
        new TextRun({
          text: line,
          font: 'Consolas',
          size: 18,
          color: HEX.textDark,
          break: idx === 0 ? 0 : 1,
        })
    ),
    spacing: { before: 80, after: 120 },
  });
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

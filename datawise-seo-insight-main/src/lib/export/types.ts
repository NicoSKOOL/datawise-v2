export type ReportSection =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'markdown'; content: string }
  | {
      type: 'kpi-grid';
      items: Array<{
        label: string;
        value: string;
        delta?: string;
        tone?: 'up' | 'down' | 'neutral';
      }>;
    }
  | {
      type: 'table';
      headers: string[];
      rows: Array<Array<string | number>>;
      caption?: string;
    }
  | { type: 'list'; items: string[]; style: 'bullet' | 'numbered' }
  | { type: 'chart'; pngDataUrl: string; caption?: string; widthPct?: number }
  | { type: 'callout'; tone: 'info' | 'warn' | 'success'; text: string }
  | { type: 'divider' };

export interface ReportPayload {
  title: string;
  subtitle?: string;
  domain?: string;
  dateRange?: { from: string; to: string };
  generatedAt: Date;
  sections: ReportSection[];
}

export type ExportFormat = 'pdf' | 'docx';

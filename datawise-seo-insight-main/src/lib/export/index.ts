import type { ExportFormat, ReportPayload } from './types';
import { downloadBlob, buildFilename } from './download';

export type { ReportPayload, ReportSection, ExportFormat } from './types';

export interface ExportOptions {
  surface: string;
  identifier?: string;
}

export async function exportReport(
  payload: ReportPayload,
  format: ExportFormat,
  options: ExportOptions
): Promise<void> {
  const blob =
    format === 'pdf'
      ? await (await import('./renderPdf')).renderPdf(payload)
      : await (await import('./renderDocx')).renderDocx(payload);

  const filename = buildFilename(
    options.surface,
    options.identifier ?? payload.domain ?? payload.title,
    format,
    payload.generatedAt
  );
  downloadBlob(blob, filename);
}

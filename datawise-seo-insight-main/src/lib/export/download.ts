import { saveAs } from 'file-saver';
import type { ExportFormat } from './types';

export function slugifyForFilename(input: string | undefined): string {
  if (!input) return 'report';
  return input
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'report';
}

export function buildFilename(
  surface: string,
  identifier: string | undefined,
  format: ExportFormat,
  generatedAt: Date = new Date()
): string {
  const dateStr = generatedAt.toISOString().slice(0, 10);
  const id = slugifyForFilename(identifier);
  return `datawise-${surface}-${id}-${dateStr}.${format}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  saveAs(blob, filename);
}

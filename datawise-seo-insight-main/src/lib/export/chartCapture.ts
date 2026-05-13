import type { RefObject } from 'react';

export async function captureElementPng(
  element: HTMLElement | null,
  options: { backgroundColor?: string; scale?: number } = {}
): Promise<string | null> {
  if (!element) return null;
  const { default: html2canvas } = await import('html2canvas');
  const canvas = await html2canvas(element, {
    backgroundColor: options.backgroundColor ?? '#ffffff',
    scale: options.scale ?? 2,
    logging: false,
    useCORS: true,
  });
  return canvas.toDataURL('image/png');
}

export async function captureRefPng(
  ref: RefObject<HTMLElement>,
  options?: { backgroundColor?: string; scale?: number }
): Promise<string | null> {
  return captureElementPng(ref.current, options);
}

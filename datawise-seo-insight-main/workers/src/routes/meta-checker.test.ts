import { describe, it, expect } from 'vitest';
import { parseMeta } from './meta-checker';

describe('parseMeta', () => {
  it('reads title and description from <head> (classic SSR)', () => {
    const html = `<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <title>My Page Title</title>
      <meta name="description" content="A normal meta description that is here.">
    </head><body><h1>Hi</h1></body></html>`;
    const r = parseMeta(html);
    expect(r.title).toBe('My Page Title');
    expect(r.description).toBe('A normal meta description that is here.');
  });

  // Regression: Next.js 15.2+ "streaming metadata" — for non-bot UAs Next streams
  // <title>/<meta> into the <body> (after </head>) and React hoists them client
  // side. The head-only scan reported these real titles as "missing" (bug
  // 176b0fb6, "26 missing titles" false positive on a Next 16 site, 2026-06-16).
  it('falls back to the body when metadata is streamed after </head>', () => {
    const html = `<!DOCTYPE html><html><head>
      <meta charset="utf-8">
      <link rel="preload" href="/_next/static/x.js" as="script">
    </head><body>
      <div id="__next">content</div>
      <title>Streamed Page Title</title>
      <meta name="description" content="Streamed meta description text.">
    </body></html>`;
    const r = parseMeta(html);
    expect(r.title).toBe('Streamed Page Title');
    expect(r.description).toBe('Streamed meta description text.');
  });

  it('prefers the <head> title over any later <title> in the body', () => {
    const html = `<!DOCTYPE html><html><head><title>Real Head Title</title></head>
      <body><svg><title>icon label</title></svg></body></html>`;
    const r = parseMeta(html);
    expect(r.title).toBe('Real Head Title');
  });

  it('ignores an SVG <title> in the body when no head title exists', () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
      <body><svg viewBox="0 0 10 10"><title>close icon</title></svg>
      <p>No real page title anywhere.</p></body></html>`;
    const r = parseMeta(html);
    expect(r.title).toBeNull();
  });

  it('ignores a <title> that only appears inside an HTML comment', () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
      <body><!-- example: <title>Not the title</title> --><p>body</p></body></html>`;
    const r = parseMeta(html);
    expect(r.title).toBeNull();
  });

  it('returns nulls when title and description are genuinely absent', () => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><p>x</p></body></html>`;
    const r = parseMeta(html);
    expect(r.title).toBeNull();
    expect(r.description).toBeNull();
  });
});

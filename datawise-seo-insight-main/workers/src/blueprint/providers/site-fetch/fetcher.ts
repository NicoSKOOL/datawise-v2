// SSRF-safe HTTP helper for stage 16 overlay_existing_site.
//
// This is the ONE overlay module that performs network I/O, so it lives under
// providers/ rather than domain/: domain/ modules are pure (no fetch, no clock,
// no randomness) and the overlay parsing/matching logic (domain/overlay/*) is
// pure precisely so it stays testable without a network. Everything here that a
// pure module needs (the SSRF guard, the bot-challenge detector) is imported
// from domain/ and reused, never reimplemented.
//
// These are FREE direct fetches of a project's own site (robots.txt, sitemaps,
// a bounded set of page <title>s), not DataForSEO calls, so there is no
// provider_usage / budget machinery here: the overlay handler (Task 18) owns the
// per-run fetch budget (ruleset.overlay.maxPageFetches) by choosing how many
// times to call fetchPageTitle, not by reserving dollars.
//
// Determinism: the only clock this module reads is the per-request abort timeout;
// there is no randomness and no dependence on wall-clock beyond that deadline.

import { assertPublicWebTarget } from '../../domain/url';
import { BlueprintValidationError } from '../../domain/errors';
import { detectBotChallenge } from '../../domain/bot-challenge';

// Why a typed failure: the overlay handler must turn a fetch that could not
// complete into a warning (inventory_limited / a skipped title) rather than a
// hard stage failure, and it must NOT treat an SSRF rejection the same as a
// slow site. `reason` lets the handler branch:
//   - 'ssrf'              : target (or a redirect hop) resolved to a private /
//                           non-public / non-http(s) host. Never retried.
//   - 'timeout'           : the 10s (default) deadline fired.
//   - 'too_many_redirects': exceeded the redirect cap (a redirect loop).
//   - 'network'           : DNS / connection / stream error.
export type SiteFetchFailureReason = 'ssrf' | 'timeout' | 'too_many_redirects' | 'network';

export class SiteFetchError extends Error {
  constructor(
    public reason: SiteFetchFailureReason,
    message: string
  ) {
    super(message);
    this.name = 'SiteFetchError';
  }
}

// Default request deadline. Overridable per call so tests can drive the timeout
// path with a tiny budget instead of fake timers.
const DEFAULT_TIMEOUT_MS = 10_000;
// Redirect hops we will follow, re-validating the target at every hop. 3 covers
// the common http->https / apex->www / trailing-slash chain without letting a
// site walk us around a loop or off to an internal host on the 4th hop.
const MAX_REDIRECTS = 3;
// Hard body ceiling for a full resource fetch (robots.txt, a sitemap). Read as a
// byte budget off the stream and truncated; the body is NEVER buffered unbounded.
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
// A title lives in <head>, so a page <title> fetch does not need the whole
// document. 64KB comfortably covers a <head> plus any bot-challenge stub while
// keeping the read cheap.
const TITLE_FETCH_BYTES = 64 * 1024; // 64KB
// Upper bound on the extracted <title> text we keep. Titles beyond this are
// truncated defensively (a hostile page could ship a megabyte "title").
const MAX_TITLE_CHARS = 300;
// How much of the body the bot-challenge detector scans for interstitial phrases.
const CHALLENGE_SAMPLE_CHARS = 8_000;

const NON_RETRYABLE_STATUS_MIN = 300;
const NON_RETRYABLE_STATUS_MAX = 400;

export interface FetchTextOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

export interface TextResource {
  // The final HTTP status. HTTP error statuses (4xx/5xx) are returned here, not
  // thrown: a 404 robots.txt is normal, not a stage failure.
  status: number;
  // The URL actually read (after any followed redirects).
  finalUrl: string;
  // Decoded body, possibly truncated to the byte budget.
  body: string;
  truncated: boolean;
  contentType: string | null;
}

// Re-validate a URL as a public web target, remapping the domain layer's
// BlueprintValidationError into a SiteFetchError('ssrf') so every failure this
// module throws is a SiteFetchError the handler can switch on.
function assertPublicOrThrow(rawUrl: string, context: string): string {
  try {
    return assertPublicWebTarget(rawUrl);
  } catch (err) {
    if (err instanceof BlueprintValidationError) {
      throw new SiteFetchError('ssrf', `${context}: ${err.message}`);
    }
    throw err;
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

// Stream-read a response body up to `maxBytes`, truncating rather than buffering
// the whole thing. Returns the decoded text and whether it was cut short.
async function readBoundedBody(
  response: Response,
  maxBytes: number
): Promise<{ body: string; truncated: boolean }> {
  const stream = response.body;
  if (!stream) {
    return { body: '', truncated: false };
  }
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      const remaining = maxBytes - total;
      if (value.byteLength >= remaining) {
        chunks.push(value.subarray(0, remaining));
        total += remaining;
        truncated = true;
        await reader.cancel();
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // reader already released/cancelled; nothing to do.
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Default decoder is non-fatal, so a truncation that splits a multi-byte
  // codepoint yields a replacement char instead of throwing.
  const body = new TextDecoder('utf-8').decode(merged);
  return { body, truncated };
}

// GET a text resource with SSRF validation on the initial URL AND on every
// redirect hop, a hard timeout, and a bounded body. Never throws on an HTTP
// error status (returns it); throws SiteFetchError only on SSRF / timeout /
// redirect-cap / network failures.
export async function fetchTextResource(
  url: string,
  opts: FetchTextOptions = {}
): Promise<TextResource> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? MAX_BODY_BYTES;

  let target = assertPublicOrThrow(url, 'initial target');

  for (let hop = 0; ; hop++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(target, {
        method: 'GET',
        // Manual redirect handling so we can re-run the SSRF guard on every
        // Location before following it (auto-follow would let a public URL
        // bounce us to an internal host with no second check).
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'text/html,application/xhtml+xml,application/xml,text/plain,*/*' },
      });
    } catch (err) {
      clearTimeout(timer);
      if (isAbortError(err)) {
        throw new SiteFetchError('timeout', `Fetch of ${target} timed out after ${timeoutMs}ms`);
      }
      throw new SiteFetchError('network', `Fetch of ${target} failed: ${(err as Error)?.message ?? 'network error'}`);
    }

    const status = response.status;
    const location = response.headers.get('location');
    const isRedirect = status >= NON_RETRYABLE_STATUS_MIN && status < NON_RETRYABLE_STATUS_MAX && !!location;

    if (isRedirect) {
      // Discard the redirect body and free the socket before the next hop.
      try {
        await response.body?.cancel();
      } catch {
        // best effort.
      }
      clearTimeout(timer);
      if (hop >= MAX_REDIRECTS) {
        throw new SiteFetchError('too_many_redirects', `Exceeded ${MAX_REDIRECTS} redirects starting from ${url}`);
      }
      let resolved: string;
      try {
        resolved = new URL(location as string, target).href;
      } catch {
        throw new SiteFetchError('network', `Invalid redirect Location "${location}" from ${target}`);
      }
      target = assertPublicOrThrow(resolved, 'redirect target');
      continue;
    }

    try {
      const { body, truncated } = await readBoundedBody(response, maxBytes);
      return {
        status,
        finalUrl: target,
        body,
        truncated,
        contentType: response.headers.get('content-type'),
      };
    } catch (err) {
      if (isAbortError(err)) {
        throw new SiteFetchError('timeout', `Read of ${target} timed out after ${timeoutMs}ms`);
      }
      throw new SiteFetchError('network', `Read of ${target} failed: ${(err as Error)?.message ?? 'stream error'}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export interface PageTitleOptions {
  timeoutMs?: number;
  maxBytes?: number;
}

export interface PageTitleResult {
  status: number;
  title: string | null;
  // True when the response looks like an anti-bot interstitial (see
  // domain/bot-challenge.ts). The handler reports these as blocked, NOT as
  // "the page has no title".
  blocked: boolean;
}

const XML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeBasicEntities(input: string): string {
  return input.replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => XML_ENTITIES[m] ?? m);
}

// Extract the first <title> text, entity-decoded, whitespace-collapsed and
// length-capped. Returns null when there is no non-empty title.
export function extractTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const text = decodeBasicEntities(match[1]).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > MAX_TITLE_CHARS ? text.slice(0, MAX_TITLE_CHARS) : text;
}

// Rough count of heading tags, used only as the bot-challenge detector's
// "real structural content" proxy (a challenge stub has none).
function countHeadings(html: string): number {
  const matches = html.match(/<h[1-6][\s>]/gi);
  return matches ? matches.length : 0;
}

// Length of tag-stripped visible text, used only as the detector's contentChars
// proxy. A challenge stub strips to near-nothing; a real page does not.
function visibleTextLength(html: string): number {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
}

// Bounded fetch of a page's <title> plus a bot-challenge check. Reuses
// fetchTextResource (so it inherits SSRF/redirect/timeout safety) with a small
// byte budget: a <head> is all we need. Propagates SiteFetchError so the handler
// can record a per-URL warning; the title is best-effort.
export async function fetchPageTitle(url: string, opts: PageTitleOptions = {}): Promise<PageTitleResult> {
  const res = await fetchTextResource(url, {
    timeoutMs: opts.timeoutMs,
    maxBytes: opts.maxBytes ?? TITLE_FETCH_BYTES,
  });
  const title = extractTitle(res.body);
  const blocked = detectBotChallenge({
    statusCode: res.status,
    textSample: res.body.slice(0, CHALLENGE_SAMPLE_CHARS),
    headingCount: countHeadings(res.body),
    contentChars: visibleTextLength(res.body),
  });
  return { status: res.status, title, blocked };
}

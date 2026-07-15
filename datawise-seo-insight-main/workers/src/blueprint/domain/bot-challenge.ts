// Blueprint-local bot-challenge detector.
//
// Adapted copy of the Site Audit feature's isLikelyBotChallenge heuristic
// (src/site-audit/on-page-analyzer.ts, shipped 2026-07-01 for bug 488cb637:
// homesellingplus.com returned HTTP 218 "this is fine" plus a tiny
// proof-of-work stub a real browser solves but the crawler cannot). The
// blueprint module may not import from outside src/blueprint/ (the boundary
// rule that keeps this feature self-contained), so the logic is duplicated
// here rather than imported, and re-shaped to the signal a content_parsing
// extract actually carries (a crawl status code + a text sample + a heading
// count) instead of the Site Audit OnPagePage object (title/description/h1 +
// payload size). A later overlay task reuses this same detector.
//
// The page text handed to this function is untrusted competitor-page content:
// it is only ever substring-scanned for known interstitial phrases, never
// interpreted as instructions.

export interface BotChallengeSignal {
  // Crawl HTTP status DFS reported for the page (ParsedPageExtract.statusCode).
  statusCode: number | null;
  // A short sample of the extracted page text (headings + text blocks). Only
  // lowercased-substring matched against CHALLENGE_PHRASES below.
  textSample: string;
  // Number of extracted headings; the closest structural proxy this extract
  // has for the Site Audit detector's title/description/h1 "real content" gate.
  headingCount: number;
  // Total extracted content characters (ParsedPageExtract.contentChars).
  contentChars: number;
}

// Statuses a genuine page or redirect returns. Anything else in the 2xx/3xx
// band (218, 202, 226, ...) is the hallmark of an anti-bot wall that answers
// with a success code but an empty body.
const NORMAL_STATUSES = new Set([200, 301, 302, 304, 307, 308]);

// Lowercased phrases anti-bot interstitials (Cloudflare, DDoS-Guard,
// PerimeterX, custom PoW walls) commonly render in the stub they serve a
// crawler. Matched case-insensitively as substrings of the extracted text.
const CHALLENGE_PHRASES = [
  'checking your browser',
  'just a moment',
  'enable javascript',
  'ddos protection by',
  'attention required',
  'cf-browser-verification',
  'please verify you are a human',
  'verifying you are human',
  'ray id',
];

// Conservative on purpose, mirroring the Site Audit precedent: only reports a
// challenge when there is affirmative evidence of one, never merely because a
// page came back thin. Two independent signals:
//
//   1. The extracted text contains a known interstitial phrase (fires even on
//      a normal 200, since some walls serve "checking your browser" under 200).
//   2. The page yielded no real content at all (no text, no headings) AND the
//      crawl status is an anomalous 2xx/3xx (218/202/226...): a success code
//      with an empty body is the classic challenge tell.
//
// A plain empty 200 (no anomalous status, no phrase) is NOT a challenge here:
// it is genuinely thin content, which the caller classifies as `empty`. A
// 4xx/5xx is a real fetch error the caller classifies as `failed`, never
// blocked.
export function detectBotChallenge(signal: BotChallengeSignal): boolean {
  const sample = signal.textSample.toLowerCase();
  if (CHALLENGE_PHRASES.some((phrase) => sample.includes(phrase))) return true;

  if (signal.contentChars > 0 || signal.headingCount > 0) return false;
  const status = signal.statusCode;
  return status !== null && status >= 200 && status < 400 && !NORMAL_STATUSES.has(status);
}

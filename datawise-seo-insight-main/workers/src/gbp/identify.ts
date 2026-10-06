// Turns whatever a member pastes into something DataForSEO can look up.
// Mirrors the URL parsing in routes/local-seo.ts handleResolveGBPUrl, plus the
// path-form data token (/data=!1s0x...:0x...) that long Maps links carry.

export type GbpInput =
  | { kind: 'maps_url'; url: string }
  | { kind: 'place_id'; placeId: string }
  | { kind: 'cid'; cid: string }
  | { kind: 'name'; query: string };

export interface MapsUrlParts {
  cid: string | null;
  placeId: string | null;
  businessQuery: string | null;
}

const MAPS_HOST = /^(https?:\/\/)?(maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)/i;
const SHORT_LINK = /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl|g\.co)\//i;

export function classifyGbpInput(raw: string): GbpInput {
  const s = raw.trim();
  if (MAPS_HOST.test(s)) return { kind: 'maps_url', url: /^https?:\/\//i.test(s) ? s : `https://${s}` };
  const cid = s.match(/^cid:?\s*(\d{10,25})$/i) ?? s.match(/^(\d{10,25})$/);
  if (cid) return { kind: 'cid', cid: cid[1] };
  if (/^ChIJ[A-Za-z0-9_-]{10,}$/.test(s)) return { kind: 'place_id', placeId: s };
  return { kind: 'name', query: s };
}

function hexCid(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(':');
  if (parts.length !== 2 || !/^0x[0-9a-f]+$/i.test(parts[1])) return null;
  try { return BigInt(parts[1]).toString(); } catch { return null; }
}

export async function parseMapsUrl(url: string, fetchImpl: typeof fetch = fetch): Promise<MapsUrlParts> {
  let resolved = url;
  if (SHORT_LINK.test(resolved)) {
    const resp = await fetchImpl(resolved, { redirect: 'follow' });
    resolved = resp.url || resolved;
  }
  let parsed: URL;
  try { parsed = new URL(resolved); } catch { return { cid: null, placeId: null, businessQuery: null }; }

  let cid = hexCid(parsed.searchParams.get('ftid'));
  const cidParam = parsed.searchParams.get('cid');
  if (!cid && cidParam && /^\d{10,25}$/.test(cidParam)) cid = cidParam;
  if (!cid) {
    const haystack = `${parsed.searchParams.get('data') ?? ''} ${decodeURIComponent(parsed.pathname)}`;
    const m = haystack.match(/!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)/);
    if (m) cid = hexCid(m[1]);
  }

  const pid = parsed.searchParams.get('place_id') ?? parsed.searchParams.get('query_place_id');
  const placeId = pid && /^ChIJ/.test(pid) ? pid : null;

  const path = parsed.pathname.match(/\/maps\/place\/([^/@]+)/);
  const businessQuery = path ? decodeURIComponent(path[1].replace(/\+/g, ' ')) : null;

  return { cid, placeId, businessQuery };
}

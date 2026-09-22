import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../dataforseo/client', () => ({
  dataforseoRequest: vi.fn(),
  dataforseoRequestCached: vi.fn(),
  dataforseoGet: vi.fn(),
}));

import { dataforseoRequest, dataforseoRequestCached } from '../dataforseo/client';
import { parseMapsPlaceUrl, selectVerifiedBusiness, handleResolveGBPUrl } from './local-seo';

// Regression for bug f74b3e81: a maps.app.goo.gl link for McKnight's Flat Pack
// Assembly (UK) resolved to a different business. The feature id lives in the
// URL path (data=...), the location was hardcoded to the US, and the first
// search result was returned unchecked.

const MCKNIGHT_URL =
  "https://www.google.com/maps/place/McKnight's+Flat+Pack+Assembly/@54.1452228,-5.4432084,454730m/data=!3m2!1e3!4b1!4m6!3m5!1s0x267b3cd7cfbaab7:0xaa695ecb51a040c7!8m2!3d54.1508183!4d-4.1245128!16s%2Fg%2F11zhb3ld3p?entry=tts";
const MCKNIGHT_CID = '12279450086343196871';

const mockedRequest = vi.mocked(dataforseoRequest);
const mockedCached = vi.mocked(dataforseoRequestCached);
const env = {} as any;

function dfs(items: any[]) {
  return { tasks: [{ result: [{ items }] }] };
}

function req(body: unknown) {
  return new Request('https://api.test/api/local-seo/resolve-gbp-url', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('parseMapsPlaceUrl', () => {
  it('extracts the CID from the path data= segment and the !3d/!4d pin', () => {
    const info = parseMapsPlaceUrl(MCKNIGHT_URL);
    expect(info?.cid).toBe(MCKNIGHT_CID);
    expect(info?.lat).toBe(54.1508183);
    expect(info?.lng).toBe(-4.1245128);
    expect(info?.name).toBe("McKnight's Flat Pack Assembly");
  });

  it('reads a ?cid= URL', () => {
    const info = parseMapsPlaceUrl('https://maps.google.com/?cid=12279450086343196871');
    expect(info?.cid).toBe(MCKNIGHT_CID);
    expect(info?.name).toBeUndefined();
  });

  it('reads an ftid= URL', () => {
    const info = parseMapsPlaceUrl('https://www.google.com/maps?ftid=0x267b3cd7cfbaab7:0xaa695ecb51a040c7');
    expect(info?.cid).toBe(MCKNIGHT_CID);
  });

  it('finds an encoded feature id', () => {
    const info = parseMapsPlaceUrl('https://www.google.com/maps/place/X/data=%211s0x1%3A0xaa695ecb51a040c7');
    expect(info?.cid).toBe(MCKNIGHT_CID);
  });

  it('returns null for a non-URL', () => {
    expect(parseMapsPlaceUrl('not a url')).toBeNull();
  });
});

describe('selectVerifiedBusiness', () => {
  const target = { cid: MCKNIGHT_CID, lat: 54.1508183, lng: -4.1245128 };

  it('prefers the CID match over the first item', () => {
    const items = [{ title: 'Wrong', cid: '1' }, { title: 'Right', cid: MCKNIGHT_CID }];
    expect(selectVerifiedBusiness(items, target)?.title).toBe('Right');
  });

  it('falls back to the nearest item within 5 km of the pin', () => {
    const items = [
      { title: 'Far', cid: '1', latitude: 51.5, longitude: -0.12 },
      { title: 'Near', cid: '2', latitude: 54.152, longitude: -4.126 },
    ];
    expect(selectVerifiedBusiness(items, target)?.title).toBe('Near');
  });

  it('returns null when nothing matches', () => {
    const items = [{ title: 'Far', cid: '1', latitude: 51.5, longitude: -0.12 }];
    expect(selectVerifiedBusiness(items, target)).toBeNull();
  });
});

describe('handleResolveGBPUrl', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    mockedCached.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => ({ url: MCKNIGHT_URL }) as Response));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolves a short link by CID and passes the chosen location_code', async () => {
    mockedCached.mockResolvedValueOnce(dfs([{ title: "McKnight's Flat Pack Assembly", cid: MCKNIGHT_CID }]));
    const res = await handleResolveGBPUrl(req({ url: 'https://maps.app.goo.gl/ngp9SLf7Q38GQgPU7', location_code: 2826 }), env);
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.title).toBe("McKnight's Flat Pack Assembly");
    expect(body.cid).toBe(MCKNIGHT_CID);
    const payload = mockedCached.mock.calls[0][2] as any[];
    expect(payload[0].keyword).toBe(`cid:${MCKNIGHT_CID}`);
    expect(payload[0].location_code).toBe(2826);
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('defaults location_code to 2840 when absent', async () => {
    mockedCached.mockResolvedValueOnce(dfs([{ title: 'M', cid: MCKNIGHT_CID }]));
    await handleResolveGBPUrl(req({ url: MCKNIGHT_URL }), env);
    expect((mockedCached.mock.calls[0][2] as any[])[0].location_code).toBe(2840);
  });

  it('rejects an invalid location_code', async () => {
    const res = await handleResolveGBPUrl(req({ url: MCKNIGHT_URL, location_code: -3 }), env);
    expect(res.status).toBe(400);
    expect(mockedCached).not.toHaveBeenCalled();
  });

  it('rejects a mismatched first result instead of returning it', async () => {
    mockedCached.mockResolvedValueOnce(dfs([{ title: 'Some US Business', cid: '999' }]));
    mockedRequest.mockResolvedValueOnce(dfs([
      { type: 'maps_search', title: 'Wrong Flat Pack Co', cid: '123', latitude: 40.7, longitude: -74 },
    ]));
    const res = await handleResolveGBPUrl(req({ url: MCKNIGHT_URL, location_code: 2826 }), env);
    expect(res.status).toBe(422);
    const body = await res.json() as any;
    expect(body.error).toBe("Couldn't match this Maps link to a business. Try the Search tab.");
    expect((mockedRequest.mock.calls[0][2] as any[])[0].location_code).toBe(2826);
  });

  it('accepts the SERP item matching the CID even when it is not first', async () => {
    mockedCached.mockResolvedValueOnce(dfs([]));
    mockedRequest.mockResolvedValueOnce(dfs([
      { type: 'maps_search', title: 'Wrong', cid: '123' },
      { type: 'maps_search', title: "McKnight's Flat Pack Assembly", cid: MCKNIGHT_CID },
    ]));
    const res = await handleResolveGBPUrl(req({ url: MCKNIGHT_URL }), env);
    expect(res.status).toBe(200);
    expect((await res.json() as any).title).toBe("McKnight's Flat Pack Assembly");
  });
});

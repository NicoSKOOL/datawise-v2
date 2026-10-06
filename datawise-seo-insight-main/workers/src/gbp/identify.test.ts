import { describe, it, expect, vi } from 'vitest';
import { classifyGbpInput, parseMapsUrl } from './identify';

describe('classifyGbpInput', () => {
  it('detects maps links in every common shape', () => {
    expect(classifyGbpInput('https://maps.app.goo.gl/AbC123').kind).toBe('maps_url');
    expect(classifyGbpInput('https://goo.gl/maps/AbC123').kind).toBe('maps_url');
    expect(classifyGbpInput('https://www.google.com/maps/place/Acme+Plumbing/@-37.8,144.9,17z/data=!4m6!3m5!1s0x6ad642af0f11fd81:0x5045675218ce6e0!8m2').kind).toBe('maps_url');
    expect(classifyGbpInput('google.com.au/maps/place/Acme').kind).toBe('maps_url');
    expect(classifyGbpInput('https://maps.google.com/?cid=5045675218ce6e0').kind).toBe('maps_url');
  });
  it('detects cid with or without prefix', () => {
    expect(classifyGbpInput('cid:194604053573767737')).toEqual({ kind: 'cid', cid: '194604053573767737' });
    expect(classifyGbpInput(' 194604053573767737 ')).toEqual({ kind: 'cid', cid: '194604053573767737' });
  });
  it('detects place ids', () => {
    expect(classifyGbpInput('ChIJN1t_tDeuEmsRUsoyG83frY4')).toEqual({ kind: 'place_id', placeId: 'ChIJN1t_tDeuEmsRUsoyG83frY4' });
  });
  it('falls back to a name search', () => {
    expect(classifyGbpInput("Joe's Plumbing, Melbourne")).toEqual({ kind: 'name', query: "Joe's Plumbing, Melbourne" });
  });
});

describe('parseMapsUrl', () => {
  it('reads the cid from a long place url data token in the path', async () => {
    const url = 'https://www.google.com/maps/place/Acme+Plumbing/@-37.8,144.9,17z/data=!3m1!4b1!4m6!3m5!1s0x6ad642af0f11fd81:0x5045675218ce6e0!8m2!3d-37.8!4d144.9';
    const parts = await parseMapsUrl(url, vi.fn() as any);
    expect(parts.cid).toBe(BigInt('0x5045675218ce6e0').toString());
    expect(parts.businessQuery).toBe('Acme Plumbing');
    expect(parts.placeId).toBeNull();
  });
  it('reads ftid and cid query params', async () => {
    expect((await parseMapsUrl('https://www.google.com/maps?ftid=0x1:0xabc', vi.fn() as any)).cid).toBe(BigInt('0xabc').toString());
    expect((await parseMapsUrl('https://maps.google.com/?cid=194604053573767737', vi.fn() as any)).cid).toBe('194604053573767737');
  });
  it('reads a place_id query param', async () => {
    const parts = await parseMapsUrl('https://www.google.com/maps/search/?api=1&query=x&query_place_id=ChIJN1t_tDeuEmsRUsoyG83frY4', vi.fn() as any);
    expect(parts.placeId).toBe('ChIJN1t_tDeuEmsRUsoyG83frY4');
  });
  it('follows short links with the injected fetch', async () => {
    const fetchImpl = vi.fn(async () => ({ url: 'https://www.google.com/maps/place/Acme/data=!1s0x1:0xff' }));
    const parts = await parseMapsUrl('https://maps.app.goo.gl/AbC', fetchImpl as any);
    expect(fetchImpl).toHaveBeenCalledWith('https://maps.app.goo.gl/AbC', { redirect: 'follow' });
    expect(parts.cid).toBe('255');
  });
  it('returns nulls for garbage', async () => {
    expect(await parseMapsUrl('not a url', vi.fn() as any)).toEqual({ cid: null, placeId: null, businessQuery: null });
  });
});

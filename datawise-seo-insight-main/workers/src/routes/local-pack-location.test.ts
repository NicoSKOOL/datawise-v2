import { describe, it, expect } from 'vitest';
import { buildMapsSerpTask, coordinateString, isGeoPoint, mapsSearchAnchor } from './local-pack-location';

const APPIXI = { latitude: 34.147757399999996, longitude: -84.1743362 };

describe('mapsSearchAnchor', () => {
  it('anchors at the business coordinates when they are known', () => {
    const anchor = mapsSearchAnchor(APPIXI, 2840);
    expect(anchor).toEqual({
      kind: 'coordinate',
      location_coordinate: '34.147757399999996,-84.1743362,12z',
      key: 'coord:34.147757399999996,-84.1743362,12z',
    });
  });

  it('falls back to the most specific location code, then the US default', () => {
    expect(mapsSearchAnchor(null, 1014044, 2840)).toEqual({ kind: 'code', location_code: 1014044, key: 'loc:1014044' });
    expect(mapsSearchAnchor({ latitude: null, longitude: null }, null, 2840)).toMatchObject({ kind: 'code', location_code: 2840 });
    expect(mapsSearchAnchor(undefined)).toMatchObject({ kind: 'code', location_code: 2840 });
  });

  it('treats 0,0 and non-numeric coordinates as unknown', () => {
    expect(isGeoPoint({ latitude: 0, longitude: 0 })).toBe(false);
    expect(isGeoPoint({ latitude: '34.1', longitude: '-84.1' })).toBe(false);
    expect(isGeoPoint(APPIXI)).toBe(true);
    expect(mapsSearchAnchor({ latitude: 0, longitude: 0 }, 2840).kind).toBe('code');
  });
});

describe('buildMapsSerpTask', () => {
  it('sends location_coordinate and no location_code when anchored', () => {
    const task = buildMapsSerpTask('ai marketing agency', mapsSearchAnchor(APPIXI, 2840), 'en', 20);
    expect(task).toEqual({
      keyword: 'ai marketing agency',
      language_code: 'en',
      device: 'desktop',
      os: 'windows',
      depth: 20,
      location_coordinate: coordinateString(APPIXI),
    });
    expect(task).not.toHaveProperty('location_code');
  });

  it('sends location_code when no coordinates exist', () => {
    const task = buildMapsSerpTask('plumber near me', mapsSearchAnchor(null, 2826), '', 20);
    expect(task).toMatchObject({ location_code: 2826, language_code: 'en' });
    expect(task).not.toHaveProperty('location_coordinate');
  });
});

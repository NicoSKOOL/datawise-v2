import { describe, it, expect } from 'vitest';
import { toKm, radiusOptions, formatRadius } from '../distance-units';

describe('distance-units', () => {
  it('passes km through and converts miles to km', () => {
    expect(toKm(5, 'km')).toBe(5);
    expect(toKm(5, 'mi')).toBe(8.047);
  });
  it('offers km options unchanged and mile options as km values', () => {
    expect(radiusOptions('km').map((o) => o.value)).toEqual(['1', '3', '5', '10', '15']);
    const mi = radiusOptions('mi');
    expect(mi.find((o) => o.label === '3 mi')?.value).toBe('4.828');
  });
  it('keeps every mile option inside the worker clamp (0.5 to 20 km)', () => {
    for (const o of radiusOptions('mi')) {
      expect(Number(o.value)).toBeGreaterThanOrEqual(0.5);
      expect(Number(o.value)).toBeLessThanOrEqual(20);
    }
  });
  it('formats a stored km radius in either unit', () => {
    expect(formatRadius(5, 'km')).toBe('5 km');
    expect(formatRadius(5, 'mi')).toBe('3.1 mi');
    expect(formatRadius(4.828, 'mi')).toBe('3 mi');
  });
});

import { describe, it, expect } from 'vitest';
import { normalizeDomain, normalizeAbsoluteUrl, assertPublicWebTarget } from './url';
import { BlueprintValidationError } from './errors';

describe('normalizeDomain', () => {
  it('strips scheme, path, port, credentials, and safe www', () => {
    expect(normalizeDomain('https://user:pw@WWW.Example.com:8080/path?q=1')).toBe('example.com');
    expect(normalizeDomain('example.co.uk')).toBe('example.co.uk');
    expect(normalizeDomain('www.example.com')).toBe('example.com');
  });
  it('keeps www when it IS the registrable name', () => {
    expect(normalizeDomain('www.com')).toBe('www.com');
  });
  it('rejects garbage', () => {
    expect(() => normalizeDomain('not a domain')).toThrow(BlueprintValidationError);
    expect(() => normalizeDomain('')).toThrow(BlueprintValidationError);
  });
  it('canonicalizes trailing dots and rejects empty labels', () => {
    expect(normalizeDomain('example.com.')).toBe('example.com');
    expect(() => normalizeDomain('.')).toThrow(BlueprintValidationError);
    expect(() => normalizeDomain('a.')).toThrow(BlueprintValidationError);
    expect(() => normalizeDomain('a..b.com')).toThrow(BlueprintValidationError);
  });
});

describe('normalizeAbsoluteUrl', () => {
  it('accepts http/https only', () => {
    expect(normalizeAbsoluteUrl('https://example.com/a').href).toBe('https://example.com/a');
    expect(() => normalizeAbsoluteUrl('ftp://example.com')).toThrow(BlueprintValidationError);
    expect(() => normalizeAbsoluteUrl('javascript:alert(1)')).toThrow(BlueprintValidationError);
  });
  it('rejects credentials and fragments', () => {
    expect(() => normalizeAbsoluteUrl('https://u:p@example.com')).toThrow(BlueprintValidationError);
    expect(() => normalizeAbsoluteUrl('https://example.com/#frag')).toThrow(BlueprintValidationError);
  });
});

describe('assertPublicWebTarget', () => {
  it.each([
    'http://127.0.0.1/x', 'http://localhost/', 'http://[::1]/', 'http://10.0.0.5/',
    'http://192.168.1.1/', 'http://172.16.0.1/', 'http://169.254.169.254/latest',
    'http://foo.local/', 'file:///etc/passwd', 'ftp://example.com/',
  ])('rejects %s', (bad) => {
    expect(() => assertPublicWebTarget(bad)).toThrow();
  });
  it('accepts and normalizes a public https URL', () => {
    expect(assertPublicWebTarget('HTTPS://Example.com/path/')).toContain('example.com');
  });
});

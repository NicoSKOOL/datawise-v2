import { describe, it, expect } from 'vitest';
import { normalizeDomain, normalizeAbsoluteUrl, assertPublicWebTarget, numericIpv4ToDottedQuad } from './url';
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

  // Alternate IPv4 encodings of private space (decimal/octal/hex/short forms).
  // These run end-to-end; in Node the URL parser also folds them, so the direct
  // numericIpv4ToDottedQuad tests below are what prove the guard's own math.
  it.each([
    'http://2130706433/',   // decimal 127.0.0.1
    'http://0177.0.0.1/',   // octal 127.0.0.1
    'http://0x7f.0.0.1/',   // hex mixed 127.0.0.1
    'http://0x7f000001/',   // hex 127.0.0.1
    'http://167772161/',    // decimal 10.0.0.1
    'http://2852039166/',   // decimal 169.254.169.254
    'http://3232235521/',   // decimal 192.168.0.1
    'http://192.168.257/',  // short-form 192.168.1.1
  ])('rejects alternate private encoding %s', (bad) => {
    expect(() => assertPublicWebTarget(bad)).toThrow(BlueprintValidationError);
  });

  it('rejects a PUBLIC numeric encoding consistently with a bare public IP', () => {
    // The guard rejects ALL bare IPv4 literals (project targets are hostnames):
    // PRIVATE_HOST already refuses 8.8.8.8, so its numeric encoding is refused the
    // same way. Rejected-consistently, no legitimate hostname is affected because
    // a hostname is never a pure numeric form.
    expect(() => assertPublicWebTarget('http://8.8.8.8/')).toThrow(BlueprintValidationError);
    expect(() => assertPublicWebTarget('http://134744072/')).toThrow(BlueprintValidationError); // 8.8.8.8
  });

  it('does not treat a hostname that merely starts with digits as numeric', () => {
    expect(() => assertPublicWebTarget('http://123movies.example.com/')).not.toThrow();
  });
});

describe('numericIpv4ToDottedQuad', () => {
  it('normalizes decimal, octal, hex and short forms to dotted-quad', () => {
    expect(numericIpv4ToDottedQuad('2130706433')).toBe('127.0.0.1');
    expect(numericIpv4ToDottedQuad('0177.0.0.1')).toBe('127.0.0.1');
    expect(numericIpv4ToDottedQuad('0x7f.0.0.1')).toBe('127.0.0.1');
    expect(numericIpv4ToDottedQuad('0x7f000001')).toBe('127.0.0.1');
    expect(numericIpv4ToDottedQuad('127.1')).toBe('127.0.0.1');
    expect(numericIpv4ToDottedQuad('167772161')).toBe('10.0.0.1');
    expect(numericIpv4ToDottedQuad('2852039166')).toBe('169.254.169.254');
    expect(numericIpv4ToDottedQuad('3232235521')).toBe('192.168.0.1');
    expect(numericIpv4ToDottedQuad('192.168.257')).toBe('192.168.1.1');
    expect(numericIpv4ToDottedQuad('010.0.0.1')).toBe('8.0.0.1'); // octal 010 = 8, a PUBLIC address
    expect(numericIpv4ToDottedQuad('4294967295')).toBe('255.255.255.255');
  });

  it('leaves genuine public dotted-quads intact', () => {
    expect(numericIpv4ToDottedQuad('8.8.8.8')).toBe('8.8.8.8');
  });

  it('returns null for non-numeric hosts and malformed numeric input', () => {
    expect(numericIpv4ToDottedQuad('123movies.example.com')).toBeNull();
    expect(numericIpv4ToDottedQuad('example.com')).toBeNull();
    expect(numericIpv4ToDottedQuad('com')).toBeNull();
    expect(numericIpv4ToDottedQuad('0x')).toBeNull();       // no hex digits
    expect(numericIpv4ToDottedQuad('08.0.0.1')).toBeNull(); // 8 is not an octal digit
    expect(numericIpv4ToDottedQuad('999.1.1.1')).toBeNull(); // octet overflow
    expect(numericIpv4ToDottedQuad('1.2.3.4.5')).toBeNull(); // too many parts
  });
});

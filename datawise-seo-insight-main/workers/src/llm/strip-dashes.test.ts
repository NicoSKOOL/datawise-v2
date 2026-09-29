import { describe, expect, it } from 'vitest';
import { stripDashes } from './strip-dashes';

describe('stripDashes', () => {
  it('turns clause-break em and en dashes into commas', () => {
    expect(stripDashes('Accept payments globally—all in one place')).toBe('Accept payments globally, all in one place');
    expect(stripDashes('Fast – and cheap')).toBe('Fast, and cheap');
  });

  it('uses a hyphen separator for titles', () => {
    expect(stripDashes('Stripe — Online Payments', 'separator')).toBe('Stripe - Online Payments');
  });

  it('keeps number ranges as ranges', () => {
    expect(stripDashes('Open 9–5, 10 — 20 staff')).toBe('Open 9-5, 10-20 staff');
  });

  it('leaves text without dashes alone', () => {
    expect(stripDashes('Plain text, no dashes.')).toBe('Plain text, no dashes.');
    expect(stripDashes('')).toBe('');
  });
});

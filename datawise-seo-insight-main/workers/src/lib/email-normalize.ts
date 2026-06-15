import type { Env } from '../index';

// Canonicalizes an email so that provider-side aliases collapse to one identity.
// Gmail/Googlemail ignore dots and everything after "+" in the local part, and
// treat googlemail.com as gmail.com. So gsmith0572+dw5@gmail.com,
// g.smith.0572@googlemail.com, and gsmith0572@gmail.com are all the same inbox.
// We also strip "+tags" for every provider (widely supported) and lowercase.
export function normalizeEmail(raw: string): string {
  const email = (raw || '').trim().toLowerCase();
  const at = email.lastIndexOf('@');
  if (at === -1) return email;

  let local = email.slice(0, at);
  let domain = email.slice(at + 1);

  const plus = local.indexOf('+');
  if (plus !== -1) local = local.slice(0, plus);

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }

  return `${local}@${domain}`;
}

// True when the canonical form of `rawEmail` is on the banned list. Used to
// reject signups/logins from any alias variation of a banned address.
export async function isBannedEmail(env: Env, rawEmail: string): Promise<boolean> {
  const canonical = normalizeEmail(rawEmail);
  if (!canonical.includes('@')) return false;
  const row = await env.DB.prepare(
    'SELECT 1 FROM banned_emails WHERE canonical_email = ?'
  )
    .bind(canonical)
    .first();
  return Boolean(row);
}

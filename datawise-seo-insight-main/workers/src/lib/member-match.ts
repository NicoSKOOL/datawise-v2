// Pairs a blocked free account against the Skool roster when the two use
// different email addresses.
//
// The failure this exists for: a member joins Skool as one address, signs up
// for DataWise as another, the roster grant lands on an account they never log
// into, and they hit the free-credit wall while paying. Nothing in the data
// links the two addresses, so we score the circumstantial evidence instead.
//
// Weights were tuned against the live table, not guessed. An earlier pass
// scored a shared FIRST name as high as a surname and returned 117 of 728
// blocked accounts, mostly rows pairing three unrelated people who happened to
// be called Michael. Surname and shared custom domain carry the signal; a first
// name on its own is worth almost nothing.

export interface RosterCandidate {
  email: string;
  first_name: string | null;
  last_name: string | null;
  joined_date: string | null;
}

export interface BlockedAccount {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
  credits_used: number;
}

export interface Suggestion {
  member: RosterCandidate;
  score: number;
  reasons: string[];
}

/** Minimum score to show a pair. Below this the suggestions are noise. */
export const MATCH_THRESHOLD = 6;

const DEFAULT_SUGGESTION_LIMIT = 3;

// Shared-provider domains carry no identity signal: two people both on Gmail
// tells us nothing, whereas two addresses on the same company domain is strong.
const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'hotmail.com',
  'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'icloud.com',
  'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com',
  'zoho.com', 'yandex.com', 'mail.com',
]);

// Words that show up in agency email addresses and business names and would
// otherwise match a member whose actual name contains them.
const STOPWORDS = new Set([
  'seo', 'consulting', 'consultant', 'agency', 'marketing', 'media', 'digital',
  'group', 'the', 'com', 'llc', 'inc', 'ltd', 'web', 'design', 'pro', 'info',
  'contact', 'hello', 'admin', 'mail', 'email', 'online', 'services', 'service',
  'solutions', 'official', 'team', 'work', 'business', 'company', 'studio',
  'labs', 'net', 'org', 'site', 'sites', 'website', 'websites', 'local',
]);

function tokens(value: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of String(value || '').toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length >= 3 && !STOPWORDS.has(raw) && !/^\d+$/.test(raw)) out.add(raw);
  }
  return out;
}

function localPart(email: string | null | undefined): string {
  return String(email || '').toLowerCase().split('@')[0] || '';
}

function domain(email: string | null | undefined): string {
  const parts = String(email || '').toLowerCase().split('@');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function parseDate(value: string | null | undefined): number | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  // D1 stores 'YYYY-MM-DD HH:MM:SS'; Skool exports sometimes use ISO.
  const ms = Date.parse(raw.replace(' ', 'T') + (/[Z+]/.test(raw) ? '' : 'Z'));
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Circumstantial-evidence score that `account` and `member` are one person.
 * Returns the score plus human-readable reasons for the admin UI, so a link is
 * never a black-box suggestion.
 */
export function scoreMatch(
  account: BlockedAccount,
  member: RosterCandidate,
): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];

  const accountTokens = new Set([...tokens(localPart(account.email)), ...tokens(account.name)]);
  const firstTokens = tokens(member.first_name);
  const lastTokens = tokens(member.last_name);

  const surnameHits = [...lastTokens].filter(t => accountTokens.has(t));
  if (surnameHits.length > 0) {
    score += 4;
    reasons.push(`surname "${surnameHits.join('/')}" matches the account`);
  } else {
    // Catches surnames welded into a compound local part, which no tokenizer
    // splits: "street" inside "seostreetconsulting".
    const surname = String(member.last_name || '').toLowerCase().trim();
    if (surname.length >= 4 && !STOPWORDS.has(surname) && localPart(account.email).includes(surname)) {
      score += 4;
      reasons.push(`surname "${surname}" appears inside the email address`);
    }
  }

  const firstHits = [...firstTokens].filter(t => accountTokens.has(t));
  if (firstHits.length > 0) {
    score += 1;
    reasons.push(`first name "${firstHits.join('/')}" matches`);
  }

  const accountDomain = domain(account.email);
  if (accountDomain && accountDomain === domain(member.email) && !FREEMAIL.has(accountDomain)) {
    score += 4;
    reasons.push(`both addresses are on @${accountDomain}`);
  }

  const signedUp = parseDate(account.created_at);
  const joined = parseDate(member.joined_date);
  if (signedUp !== null && joined !== null) {
    const hours = Math.abs(signedUp - joined) / 3_600_000;
    if (hours <= 48) {
      score += 3;
      reasons.push(`signed up ${Math.round(hours)}h from joining Skool`);
    } else if (hours <= 24 * 14) {
      score += 1;
      reasons.push(`signed up ${Math.round(hours / 24)}d from joining Skool`);
    }
  }

  return { score, reasons };
}

/** Best roster candidates for one blocked account, above threshold, best first. */
export function suggestMembers(
  account: BlockedAccount,
  roster: RosterCandidate[],
  limit: number = DEFAULT_SUGGESTION_LIMIT,
): Suggestion[] {
  const scored: Suggestion[] = [];
  for (const member of roster) {
    const { score, reasons } = scoreMatch(account, member);
    if (score >= MATCH_THRESHOLD) scored.push({ member, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score || a.member.email.localeCompare(b.member.email));
  return scored.slice(0, limit);
}

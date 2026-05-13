import type { Env } from '../index';
import { renderEmail, type EmailOptions } from './template';
import { getWinbackEmail } from './winback';

// Day offsets for each step, keyed by sequence_type.
const SCHEDULES: Record<string, Record<number, number>> = {
  credits_exhausted: { 1: 0, 2: 2, 3: 5, 4: 8, 5: 12 },
  winback: { 1: 0, 2: 14 },
};

function maxStepForType(type: string): number {
  const schedule = SCHEDULES[type];
  if (!schedule) return 0;
  return Math.max(...Object.keys(schedule).map(Number));
}

export const SENDER = 'Nico | AI Ranking <noreply@datawiseseo.com>';
const SKOOL_URL = 'https://www.skool.com/ai-ranking/';
const APP_URL = 'https://datawiseseo.com';

// Mint callout block used inside the body when showing a step-by-step "case study".
export function calloutBlock(title: string, bodyHtml: string): string {
  return `
    <div style="background:#E9F3EC; border-radius:12px; padding:18px 22px; margin:22px 0;">
      <div style="font-size:11px; font-weight:700; color:#166337; letter-spacing:1.4px; text-transform:uppercase;">${title}</div>
      <div style="font-size:15px; line-height:1.7; color:#2C3837; padding-top:8px;">${bodyHtml}</div>
    </div>
  `;
}

export function buildSequenceEmail(
  userId: string,
  workerUrl: string,
  opts: Omit<EmailOptions, 'unsubscribeUrl' | 'footerNote'>
): string {
  return renderEmail({
    ...opts,
    unsubscribeUrl: `${workerUrl}/api/unsubscribe?uid=${userId}`,
    footerNote: `You're getting this because you started using DataWise on a free plan. One note, practical stuff only — unsubscribe any time.`,
  });
}

// ── Email templates ───────────────────────────────────────────────────

function getEmail1(name: string, userId: string, workerUrl: string): { subject: string; html: string } {
  const displayName = name ? name.split(' ')[0] : 'there';
  return {
    subject: "You've used all 5 free tools on DataWise",
    html: buildSequenceEmail(userId, workerUrl, {
      preheader: "Here's what unlimited DataWise access looks like inside AI Ranking.",
      eyebrow: 'Your free plan · Step 1',
      issueLabel: 'Step 1 of 5',
      headline: `You've used<br />your <span class="dw-accent" style="color:#1F7A43;">5 free runs</span>`,
      byline: 'From Nico — founder, AI Ranking & DataWise',
      body: `
        Hi ${displayName},
        <br /><br />
        Thanks for giving DataWise a real try. You've run keyword research, competitor analysis, and the other tools — now the free credits are spent.
        <br /><br />
        Here's what a community membership unlocks:
        ${calloutBlock('Unlimited access', `
          <ul style="margin:0; padding-left:18px;">
            <li><strong>Unlimited keyword research</strong> — related, suggestions, ideas, difficulty</li>
            <li><strong>Competitor analysis</strong> — domain rankings, gaps, traffic estimation</li>
            <li><strong>AI visibility</strong> — Google AI Overviews, ChatGPT, Perplexity</li>
            <li><strong>Rank tracking</strong> — daily positions across your keywords</li>
            <li><strong>SEO Assistant</strong> — chat with your data</li>
          </ul>
        `)}
        The community is where the access lives. One flat price, everything included.
        <br /><br />
        — Nico
      `,
      postscript: 'p.s. a few tactical emails coming — no fluff —',
      buttons: [{ label: 'Join AI Ranking →', url: SKOOL_URL, variant: 'primary' }],
      trustLine: `<span style="color:#1F7A43; font-weight:700;">✓</span>&nbsp;&nbsp;Unlimited tools <span style="opacity:0.4; padding:0 6px;">·</span> Cancel any time <span style="opacity:0.4; padding:0 6px;">·</span> Community included`,
    }),
  };
}

function getEmail2(name: string, userId: string, workerUrl: string): { subject: string; html: string } {
  const displayName = name ? name.split(' ')[0] : 'there';
  return {
    subject: 'How businesses find hidden keyword opportunities',
    html: buildSequenceEmail(userId, workerUrl, {
      preheader: 'The long-tail map most teams never build — and the 4-step workflow to build it.',
      eyebrow: 'Playbook · 4 min read',
      issueLabel: 'Step 2 of 5',
      headline: `The <span class="dw-accent" style="color:#1F7A43;">keyword map</span><br />your competitors<br />never built`,
      byline: 'From Nico — founder, AI Ranking',
      body: `
        Hi ${displayName},
        <br /><br />
        A community member ran this exact workflow on their niche last month. Four steps, one afternoon:
        ${calloutBlock('The 4-step workflow', `
          <ol style="margin:0; padding-left:18px;">
            <li>Main service keyword into <strong>Keyword Ideas</strong></li>
            <li>Filter: difficulty under 30, volume above 100/mo</li>
            <li>Pull 47 untapped terms competitors weren't targeting</li>
            <li>Cluster the winners with <strong>Related Keywords</strong></li>
          </ol>
          <div style="margin-top:10px; color:#1F7A43; font-weight:700;">Result: 3 new pages in the top 10 within 6 weeks.</div>
        `)}
        Everyone crowds the head terms. The wins are in the long tail your competitors overlook.
        <br /><br />
        — Nico
      `,
      buttons: [{ label: 'Get unlimited access →', url: SKOOL_URL, variant: 'primary' }],
    }),
  };
}

function getEmail3(name: string, userId: string, workerUrl: string): { subject: string; html: string } {
  const displayName = name ? name.split(' ')[0] : 'there';
  return {
    subject: 'Are you visible in AI search results?',
    html: buildSequenceEmail(userId, workerUrl, {
      preheader: "Google AI Overviews, ChatGPT, Perplexity — your buyers are already there. Are you?",
      eyebrow: 'GEO · 4 min read',
      issueLabel: 'Step 3 of 5',
      headline: `Are you visible in<br /><span class="dw-accent" style="color:#1F7A43;">AI search results?</span>`,
      byline: 'From Nico — founder, AI Ranking',
      body: `
        Hi ${displayName},
        <br /><br />
        Google AI Overviews, ChatGPT, and Perplexity are reshaping how buyers find businesses. Traditional rankings still matter, but AI answers are quietly stealing clicks from position one.
        <br /><br />
        One member discovered a competitor was being cited in AI Overviews for their top keyword while they were invisible. Here's what they did:
        ${calloutBlock('The fix (3 weeks)', `
          <ol style="margin:0; padding-left:18px;">
            <li>Ran <strong>AI Visibility</strong> to audit presence across models</li>
            <li>Rebuilt top pages with answer capsules at the top</li>
            <li>Added FAQ sections and structured data</li>
            <li>Cited in AI Overviews for 4 target keywords</li>
          </ol>
        `)}
        This is GEO — Generative Engine Optimization. It's the next frontier, and it's measurable today.
        <br /><br />
        — Nico
      `,
      buttons: [{ label: 'See how members are adapting →', url: SKOOL_URL, variant: 'primary' }],
    }),
  };
}

function getEmail4(name: string, userId: string, workerUrl: string): { subject: string; html: string } {
  const displayName = name ? name.split(' ')[0] : 'there';
  return {
    subject: "What your competitors know that you don't",
    html: buildSequenceEmail(userId, workerUrl, {
      preheader: "A member found 120+ keywords their rival ranked for that they had no content for.",
      eyebrow: 'Case study · 3 min read',
      issueLabel: 'Step 4 of 5',
      headline: `120 keywords you<br />didn't know your<br /><span class="dw-accent" style="color:#1F7A43;">competitor owned</span>`,
      byline: 'From Nico — founder, AI Ranking',
      body: `
        Hi ${displayName},
        <br /><br />
        A member ran <strong>Keyword Gap Analysis</strong> against their top competitor. 120+ terms the competitor ranked for — zero content on their own site.
        ${calloutBlock('What they did', `
          <ul style="margin:0; padding-left:18px;">
            <li><strong>Competitor Analysis</strong> — surface the rival's top pages</li>
            <li><strong>Keyword Gap</strong> — find the missing terms</li>
            <li>Prioritize 15 by volume × difficulty</li>
            <li>Ship targeted content on the winners</li>
          </ul>
          <div style="margin-top:10px; color:#1F7A43; font-weight:700;">Result: outranked on 8 of 15 keywords in 2 months.</div>
        `)}
        The community shares wins like this every week. Gaps, reviews, algorithm shifts.
        <br /><br />
        — Nico
      `,
      buttons: [{ label: 'Join and unlock access →', url: SKOOL_URL, variant: 'primary' }],
    }),
  };
}

function getEmail5(name: string, userId: string, workerUrl: string): { subject: string; html: string } {
  const displayName = name ? name.split(' ')[0] : 'there';
  return {
    subject: 'Your DataWise account is still waiting',
    html: buildSequenceEmail(userId, workerUrl, {
      preheader: "Last note from me — here's exactly what you get, in one page.",
      eyebrow: 'Last note · 2 min read',
      issueLabel: 'Step 5 of 5',
      headline: `Your account is<br /><span class="dw-accent" style="color:#1F7A43;">still waiting</span>`,
      byline: 'From Nico — founder, AI Ranking',
      body: `
        Hi ${displayName},
        <br /><br />
        Last email on this — promise. Here's exactly what joining gets you:
        ${calloutBlock('Unlimited DataWise', `
          <ul style="margin:0; padding-left:18px;">
            <li>Keyword research — ideas, suggestions, difficulty, related</li>
            <li>Competitor analysis and keyword gap</li>
            <li>AI visibility — Google AI, ChatGPT, Perplexity</li>
            <li>Rank tracking with daily updates</li>
            <li>On-page SEO audits</li>
            <li>SEO Assistant (AI chat with your data)</li>
          </ul>
        `)}
        ${calloutBlock('Community', `
          <ul style="margin:0; padding-left:18px;">
            <li>Weekly SEO strategy discussions</li>
            <li>Case studies and member wins</li>
            <li>GEO playbooks</li>
            <li>Direct access to me — just ask</li>
          </ul>
        `)}
        Your data is saved. You can pick up right where you left off.
        <br /><br />
        Hope to see you inside,<br />
        — Nico
      `,
      postscript: "p.s. if it's not the right fit, just reply 'unsubscribe' —",
      buttons: [{ label: 'Join now →', url: SKOOL_URL, variant: 'primary' }, { label: 'Open DataWise', url: APP_URL, variant: 'ghost' }],
    }),
  };
}

// ── Sequence template dispatcher ──────────────────────────────────────

function getCreditsEmail(
  step: number,
  name: string,
  userId: string,
  workerUrl: string
): { subject: string; html: string } | null {
  switch (step) {
    case 1: return getEmail1(name, userId, workerUrl);
    case 2: return getEmail2(name, userId, workerUrl);
    case 3: return getEmail3(name, userId, workerUrl);
    case 4: return getEmail4(name, userId, workerUrl);
    case 5: return getEmail5(name, userId, workerUrl);
    default: return null;
  }
}

function getSequenceEmailByType(
  type: string,
  step: number,
  name: string,
  userId: string,
  workerUrl: string
): { subject: string; html: string } | null {
  if (type === 'credits_exhausted') return getCreditsEmail(step, name, userId, workerUrl);
  if (type === 'winback') return getWinbackEmail(step, name, userId, workerUrl);
  return null;
}

// ── Public API ────────────────────────────────────────────────────────

export async function startCreditSequence(env: Env, userId: string): Promise<void> {
  const now = new Date().toISOString();
  // OR IGNORE prevents duplicates if two requests race (unique index on user_id+sequence_type)
  await env.DB.prepare(
    `INSERT OR IGNORE INTO email_sequences (user_id, sequence_type, current_step, next_send_at)
     VALUES (?, 'credits_exhausted', 0, ?)`
  ).bind(userId, now).run();
}

export async function startWinbackSequence(env: Env, userId: string): Promise<void> {
  // Defensive: don't start if user is currently a community member.
  const u = await env.DB.prepare(
    'SELECT is_community_member FROM users WHERE id = ?'
  ).bind(userId).first();
  if (!u || u.is_community_member === 1) return;

  const now = new Date().toISOString();
  // Cancel any in-flight free-credits drip first so the inbox isn't double-tapped.
  await env.DB.prepare(
    `UPDATE email_sequences SET cancelled = 1
     WHERE user_id = ? AND sequence_type = 'credits_exhausted' AND completed = 0 AND cancelled = 0`
  ).bind(userId).run();

  // OR IGNORE prevents duplicates (unique index on user_id+sequence_type while active).
  await env.DB.prepare(
    `INSERT OR IGNORE INTO email_sequences (user_id, sequence_type, current_step, next_send_at)
     VALUES (?, 'winback', 0, ?)`
  ).bind(userId, now).run();
}

export async function cancelUserSequences(env: Env, userId: string): Promise<void> {
  await env.DB.prepare(
    `UPDATE email_sequences SET cancelled = 1
     WHERE user_id = ? AND completed = 0 AND cancelled = 0`
  ).bind(userId).run();
}

export async function processEmailSequences(env: Env): Promise<{ sent: number; errors: number }> {
  const now = new Date().toISOString();
  let sent = 0;
  let errors = 0;

  // Fetch pending sequences that are due
  const rows = await env.DB.prepare(
    `SELECT es.id, es.user_id, es.current_step, es.sequence_type, u.email, u.name, u.is_community_member
     FROM email_sequences es
     JOIN users u ON u.id = es.user_id
     WHERE es.completed = 0
       AND es.cancelled = 0
       AND es.next_send_at <= ?
     LIMIT 50`
  ).bind(now).all();

  if (!rows.results || rows.results.length === 0) {
    return { sent: 0, errors: 0 };
  }

  for (const row of rows.results) {
    // If user became a community member, cancel the sequence
    if (row.is_community_member === 1) {
      await env.DB.prepare(
        'UPDATE email_sequences SET cancelled = 1 WHERE id = ?'
      ).bind(row.id).run();
      continue;
    }

    const nextStep = (row.current_step as number) + 1;
    const name = (row.name as string | null) ?? '';
    const seqType = (row.sequence_type as string) ?? 'credits_exhausted';
    const emailContent = getSequenceEmailByType(seqType, nextStep, name, row.user_id as string, env.WORKER_URL);

    if (!emailContent) {
      await env.DB.prepare(
        'UPDATE email_sequences SET completed = 1 WHERE id = ?'
      ).bind(row.id).run();
      continue;
    }

    // Optimistic lock: claim this step before sending
    const claimed = await env.DB.prepare(
      'UPDATE email_sequences SET current_step = ? WHERE id = ? AND current_step = ?'
    ).bind(nextStep, row.id, row.current_step).run();

    if (!claimed.meta.changes) continue; // Another worker already claimed it

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: SENDER,
          to: [row.email as string],
          subject: emailContent.subject,
          html: emailContent.html,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error(`Sequence email ${nextStep} failed for ${row.email}:`, err);
        // Revert the step so it retries next cron tick
        await env.DB.prepare(
          'UPDATE email_sequences SET current_step = ? WHERE id = ?'
        ).bind(row.current_step, row.id).run();
        errors++;
        continue;
      }

      // Advance to next send time or mark complete
      const schedule = SCHEDULES[seqType] ?? {};
      const maxStep = maxStepForType(seqType);
      if (nextStep >= maxStep) {
        await env.DB.prepare(
          'UPDATE email_sequences SET completed = 1 WHERE id = ?'
        ).bind(row.id).run();
      } else {
        const daysUntilNext = (schedule[nextStep + 1] || 0) - (schedule[nextStep] || 0);
        const nextSendAt = new Date(Date.now() + daysUntilNext * 24 * 60 * 60 * 1000).toISOString();
        await env.DB.prepare(
          'UPDATE email_sequences SET next_send_at = ? WHERE id = ?'
        ).bind(nextSendAt, row.id).run();
      }

      sent++;
    } catch (err) {
      console.error(`Sequence email ${nextStep} error for ${row.email}:`, err);
      // Revert the step so it retries next cron tick
      await env.DB.prepare(
        'UPDATE email_sequences SET current_step = ? WHERE id = ?'
      ).bind(row.current_step, row.id).run();
      errors++;
    }
  }

  return { sent, errors };
}

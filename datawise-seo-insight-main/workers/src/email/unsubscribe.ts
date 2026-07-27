// Public unsubscribe endpoint.
//
// GET renders a confirmation page and MUST NOT mutate anything. The previous
// implementation was a GET that wrote straight to the database, which meant
// corporate link scanners (Defender Safe Links, Barracuda) and mail-client
// prefetch silently unsubscribed people who never clicked. RFC 8058 requires
// POST for one-click for exactly this reason.
//
// POST performs the write. It accepts both the browser form on the confirmation
// page and RFC 8058 one-click, where Gmail/Yahoo POST to the URL with body
// "List-Unsubscribe=One-Click" and no session, so no CSRF token can be required.
import type { Env } from '../index';
import { normalizeEmail } from '../lib/email-normalize';
import { suppress, verifyUnsubscribeToken, signUnsubscribeToken } from './suppression';
import { cancelUserSequences } from './sequences';

interface Target {
  email: string;
  token: string;
  userId: string | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function page(title: string, bodyHtml: string, status = 200): Response {
  return new Response(
    `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#F6F8F7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#0E1414;">
<div style="max-width:480px;margin:0 auto;padding:64px 24px;text-align:center;">
  <div style="font-size:18px;font-weight:800;letter-spacing:-0.4px;color:#1F7A43;padding-bottom:28px;">DataWise</div>
  <div style="background:#fff;border:1px solid #E3E9E6;border-radius:14px;padding:32px 28px;">
    ${bodyHtml}
  </div>
</div>
</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

/**
 * Resolve the address this request is about.
 *
 * Preferred path is `e` (canonical address) + `t` (HMAC). Legacy path is a bare
 * `uid`, which is what every email already sitting in an inbox carries: those
 * links stay working, they just land on the confirmation page instead of firing
 * a write. For the legacy path we mint a fresh valid token server-side so the
 * form POST verifies normally.
 */
async function resolveTarget(env: Env, params: URLSearchParams): Promise<Target | null> {
  const e = params.get('e');
  const t = params.get('t');
  const uid = params.get('uid');

  if (e && t) {
    if (!(await verifyUnsubscribeToken(env.UNSUBSCRIBE_SECRET, e, t))) return null;
    const canonical = normalizeEmail(e);
    let userId: string | null = null;
    if (uid) {
      // uid is not covered by the HMAC, so only trust it when it really maps
      // to the signed address.
      const row = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
        .bind(uid)
        .first<{ id: string; email: string }>();
      if (row && normalizeEmail(row.email) === canonical) userId = row.id;
    }
    if (!userId) {
      const row = await env.DB.prepare('SELECT id FROM users WHERE lower(email) = ?')
        .bind(canonical)
        .first<{ id: string }>();
      userId = row?.id ?? null;
    }
    return { email: canonical, token: t, userId };
  }

  if (uid) {
    const row = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?')
      .bind(uid)
      .first<{ id: string; email: string }>();
    if (!row) return null;
    const canonical = normalizeEmail(row.email);
    return {
      email: canonical,
      token: await signUnsubscribeToken(env.UNSUBSCRIBE_SECRET, canonical),
      userId: row.id,
    };
  }

  return null;
}

const INVALID_BODY = `
  <h2 style="margin:0 0 12px;font-size:20px;">Link not valid</h2>
  <p style="margin:0;font-size:15px;line-height:1.6;color:#4A5654;">
    This unsubscribe link is expired or incomplete. Reply to any email from us and we will take you off the list manually.
  </p>
`;

export async function handleUnsubscribe(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const target = await resolveTarget(env, url.searchParams);
    if (!target) return page('Unsubscribe', INVALID_BODY, 400);

    // Confirmation page. Nothing is written until this form is submitted.
    return page(
      'Unsubscribe',
      `
      <h2 style="margin:0 0 12px;font-size:20px;">Unsubscribe from DataWise emails?</h2>
      <p style="margin:0 0 8px;font-size:15px;line-height:1.6;color:#4A5654;">
        This stops marketing and product emails to
      </p>
      <p style="margin:0 0 24px;font-size:15px;font-weight:600;word-break:break-all;">${escapeHtml(target.email)}</p>
      <form method="POST" action="/api/unsubscribe">
        <input type="hidden" name="e" value="${escapeHtml(target.email)}" />
        <input type="hidden" name="t" value="${escapeHtml(target.token)}" />
        ${target.userId ? `<input type="hidden" name="uid" value="${escapeHtml(target.userId)}" />` : ''}
        <button type="submit" style="width:100%;background:#1F7A43;color:#fff;border:0;border-radius:9px;padding:14px 20px;font-size:15px;font-weight:600;cursor:pointer;">
          Yes, unsubscribe me
        </button>
      </form>
      <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#8A9694;">
        Account emails like password resets will still reach you.
      </p>
    `
    );
  }

  // POST: the actual write.
  // One-click (RFC 8058) posts to the URL as-is with the params in the query
  // string, so read those first and fall back to the form body.
  let params = url.searchParams;
  if (!params.get('e') && !params.get('uid')) {
    try {
      const form = await request.formData();
      const merged = new URLSearchParams();
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') merged.set(k, v);
      }
      params = merged;
    } catch {
      return page('Unsubscribe', INVALID_BODY, 400);
    }
  }

  const target = await resolveTarget(env, params);
  if (!target) return page('Unsubscribe', INVALID_BODY, 400);

  await suppress(env, target.email, {
    reason: 'unsubscribe',
    scope: 'marketing',
    source: 'self',
    userId: target.userId,
  });

  // Cancel in-flight drips immediately. The cron gate would catch this on the
  // next tick anyway, so a miss here is not a correctness problem.
  if (target.userId) {
    await cancelUserSequences(env, target.userId);
  }

  return page(
    'Unsubscribed',
    `
    <h2 style="margin:0 0 12px;font-size:20px;">You're unsubscribed</h2>
    <p style="margin:0;font-size:15px;line-height:1.6;color:#4A5654;">
      ${escapeHtml(target.email)} will no longer receive marketing or product emails from DataWise.
    </p>
    <p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#8A9694;">
      Account emails like password resets will still reach you.
    </p>
  `
  );
}

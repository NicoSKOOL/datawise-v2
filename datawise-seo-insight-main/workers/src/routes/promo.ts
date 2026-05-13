import type { Env } from '../index';

// POST /api/promo/redeem
export async function handleRedeemPromo(request: Request, env: Env, userId: string): Promise<Response> {
  const { code } = await request.json() as { code?: string };
  if (!code?.trim()) {
    return new Response(JSON.stringify({ error: 'Promo code is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const normalized = code.trim().toUpperCase();

  // Look up the promo code
  const promo = await env.DB.prepare(
    'SELECT id, code, label, duration_hours, max_redemptions, expires_at FROM promo_codes WHERE code = ? AND is_active = 1'
  ).bind(normalized).first();

  if (!promo) {
    return new Response(JSON.stringify({ error: 'Invalid or inactive promo code' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check if promo code has expired
  if (promo.expires_at) {
    const expiresAt = new Date(promo.expires_at as string).getTime();
    if (Date.now() > expiresAt) {
      return new Response(JSON.stringify({ error: 'This promo code has expired' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Check if user already redeemed this code
  const existing = await env.DB.prepare(
    'SELECT 1 FROM promo_redemptions WHERE user_id = ? AND promo_code_id = ?'
  ).bind(userId, promo.id).first();

  if (existing) {
    return new Response(JSON.stringify({ error: 'You have already redeemed this promo code' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // Check max redemptions (skip if NULL)
  if (promo.max_redemptions !== null) {
    const countResult = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM promo_redemptions WHERE promo_code_id = ?'
    ).bind(promo.id).first();
    const count = (countResult?.count as number) || 0;
    if (count >= (promo.max_redemptions as number)) {
      return new Response(JSON.stringify({ error: 'This promo code has reached its redemption limit' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
  }

  const durationHours = (promo.duration_hours as number) || 48;

  // Insert redemption
  await env.DB.prepare(
    `INSERT INTO promo_redemptions (id, user_id, promo_code_id, expires_at)
     VALUES (lower(hex(randomblob(16))), ?, ?, datetime('now', '+' || ? || ' hours'))`
  ).bind(userId, promo.id, durationHours).run();

  // Fetch the created redemption to get the actual expires_at
  const redemption = await env.DB.prepare(
    'SELECT expires_at FROM promo_redemptions WHERE user_id = ? AND promo_code_id = ?'
  ).bind(userId, promo.id).first();

  return new Response(JSON.stringify({
    success: true,
    expires_at: redemption?.expires_at,
    label: promo.label,
    duration_hours: durationHours,
  }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

// GET /api/promo/status
export async function handlePromoStatus(request: Request, env: Env, userId: string): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT pr.expires_at, pc.code, pc.label
     FROM promo_redemptions pr
     JOIN promo_codes pc ON pc.id = pr.promo_code_id
     WHERE pr.user_id = ? AND pr.expires_at > datetime('now')
     ORDER BY pr.expires_at DESC LIMIT 1`
  ).bind(userId).first();

  if (result) {
    return new Response(JSON.stringify({
      active: true,
      code: result.code,
      label: result.label,
      expires_at: result.expires_at,
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ active: false, label: null, expires_at: null }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

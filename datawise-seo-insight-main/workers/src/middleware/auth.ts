import type { Env } from '../index';
import type { AuthUser } from '../auth/google';

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function authMiddleware(request: Request, env: Env): Promise<AuthUser | null> {
  const token = request.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token) return null;

  const tokenHash = await hashToken(token);

  // Fast path: check KV cache
  const cachedUserId = await env.KV.get(`session:${tokenHash}`);

  let userId: string | null = null;

  if (cachedUserId) {
    userId = cachedUserId;
  } else {
    // Fallback: check D1
    const session = await env.DB.prepare(
      'SELECT user_id, expires_at FROM sessions WHERE token_hash = ?'
    ).bind(tokenHash).first();

    if (!session) return null;

    // Check expiry
    if (new Date(session.expires_at as string) < new Date()) {
      await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
      return null;
    }

    userId = session.user_id as string;

    // Re-cache in KV
    const ttl = Math.floor((new Date(session.expires_at as string).getTime() - Date.now()) / 1000);
    if (ttl > 0) {
      await env.KV.put(`session:${tokenHash}`, userId, { expirationTtl: ttl });
    }
  }

  // Fetch user
  const user = await env.DB.prepare(
    'SELECT id, google_id, email, name, avatar_url, subscription_tier, is_community_member, credits_used FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!user) return null;

  return {
    id: user.id as string,
    google_id: user.google_id as string,
    email: user.email as string,
    name: user.name as string,
    avatar_url: user.avatar_url as string,
    subscription_tier: user.subscription_tier as string,
    is_community_member: Boolean(user.is_community_member),
    credits_used: (user.credits_used as number) || 0,
  };
}

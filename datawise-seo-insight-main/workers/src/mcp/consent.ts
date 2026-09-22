import type { McpEnv } from './env';
import type { AuthUser } from '../auth/google';
import { readStash, deleteStash, isLoopbackRedirect } from './authorize';
import { loadIdentity, checkAccess, denialMessage } from './access';

type Json = (data: unknown, status?: number) => Response;

const EXPIRED = { error: 'expired', message: 'This connection request expired or was already used. Go back to your AI assistant and add the DataWise connector again.' };

async function readReq(request: Request): Promise<string> {
  const url = new URL(request.url);
  if (request.method === 'GET') return url.searchParams.get('req') ?? '';
  try {
    const body = (await request.json()) as { req?: unknown };
    return typeof body.req === 'string' ? body.req : '';
  } catch {
    return '';
  }
}

// Spec 4.2 steps 3 and 4 plus the connected-apps list (spec 7). Every route
// here is behind the DataWise session (authMiddleware in account.ts) and the
// frontend CORS allowlist. Returns null for paths it does not own.
export async function handleConsentRequest(request: Request, env: McpEnv, user: AuthUser, json: Json): Promise<Response | null> {
  const path = new URL(request.url).pathname;

  if (path === '/account/authorize-request' && request.method === 'GET') {
    const stash = await readStash(env, await readReq(request));
    if (!stash) return json(EXPIRED, 410);
    const identity = await loadIdentity(env, { userId: user.id, tokenId: '', tokenName: stash.client.clientName }, 'oauth');
    if (!identity) return json({ error: 'unauthorized' }, 401);
    const denial = await checkAccess(env, identity);
    return json({
      client_name: stash.client.clientName,
      client_uri: stash.client.clientUri ?? null,
      redirect_host: new URL(stash.redirectUri).host,
      loopback: isLoopbackRedirect(stash.redirectUri),
      scope: ['read'],
      email: identity.email,
      access: denial === null,
      denial,
      denial_message: denial ? denialMessage(denial) : null,
    });
  }

  if (path === '/account/authorize-request/approve' && request.method === 'POST') {
    const req = await readReq(request);
    const stash = await readStash(env, req);
    if (!stash) return json(EXPIRED, 410);
    const identity = await loadIdentity(env, { userId: user.id, tokenId: '', tokenName: stash.client.clientName }, 'oauth');
    if (!identity) return json({ error: 'unauthorized' }, 401);
    const denial = await checkAccess(env, identity);
    if (denial) return json({ error: denial, message: denialMessage(denial) }, 403);
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: stash.authRequest,
      userId: user.id,
      metadata: { clientName: stash.client.clientName, clientUri: stash.client.clientUri ?? null, redirectUri: stash.redirectUri, approvedAt: new Date().toISOString() },
      scope: ['read'],
      props: { userId: user.id, email: identity.email, clientName: stash.client.clientName, authKind: 'oauth', tokenId: `oauth:${stash.client.clientId}` },
    });
    await deleteStash(env, req);
    return json({ redirect_to: redirectTo });
  }

  if (path === '/account/authorize-request/deny' && request.method === 'POST') {
    const req = await readReq(request);
    const stash = await readStash(env, req);
    if (!stash) return json(EXPIRED, 410);
    const redirect = new URL(stash.redirectUri);
    redirect.searchParams.set('error', 'access_denied');
    redirect.searchParams.set('error_description', 'The DataWise member declined the connection.');
    if (stash.authRequest.state) redirect.searchParams.set('state', stash.authRequest.state);
    if (stash.authRequest.issuer) redirect.searchParams.set('iss', stash.authRequest.issuer);
    await deleteStash(env, req);
    return json({ redirect_to: redirect.toString() });
  }

  if (path === '/account/grants' && request.method === 'GET') {
    const { items } = await env.OAUTH_PROVIDER.listUserGrants(user.id, { limit: 100 });
    const grants = items
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((g) => ({
        id: g.id,
        client_id: g.clientId,
        client_name: (g.metadata && typeof g.metadata.clientName === 'string' && g.metadata.clientName) || g.clientId,
        created_at: new Date(g.createdAt * 1000).toISOString(),
        scope: g.scope,
      }));
    return json({ grants });
  }

  const grantMatch = path.match(/^\/account\/grants\/([A-Za-z0-9_-]+)$/);
  if (grantMatch && request.method === 'DELETE') {
    // revokeGrant is scoped to (grantId, userId): another user's id never matches.
    await env.OAUTH_PROVIDER.revokeGrant(grantMatch[1], user.id);
    return json({ ok: true });
  }

  return null;
}

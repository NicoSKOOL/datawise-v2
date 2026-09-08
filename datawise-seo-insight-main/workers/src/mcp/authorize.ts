import { AuthorizationError, CimdFetchError, type AuthRequest } from '@cloudflare/workers-oauth-provider';
import type { McpEnv } from './env';

export const AUTHREQ_PREFIX = 'mcp_authreq:';
export const AUTHREQ_TTL_SECONDS = 600;

export interface StashedAuthRequest {
  authRequest: AuthRequest;
  client: { clientId: string; clientName: string; clientUri?: string; logoUri?: string };
  redirectUri: string;
  createdAt: string;
}

export function isLoopbackRedirect(uri: string): boolean {
  try {
    const host = new URL(uri).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

function nonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function readStash(env: McpEnv, req: string): Promise<StashedAuthRequest | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(req)) return null;
  const raw = await env.KV.get(`${AUTHREQ_PREFIX}${req}`);
  return raw ? (JSON.parse(raw) as StashedAuthRequest) : null;
}

export async function deleteStash(env: McpEnv, req: string): Promise<void> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(req)) return;
  await env.KV.delete(`${AUTHREQ_PREFIX}${req}`);
}

const CIMD_UNVERIFIABLE_MESSAGE = 'The connecting app could not be verified (its client metadata document could not be fetched).';

// Minimal HTML for errors we must render locally (unknown client, bad
// redirect). The SPA never sees these; they only appear if a client is broken.
function localError(message: string): Response {
  const safe = message.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
  const html = `<!doctype html><meta charset="utf-8"><title>DataWise: connection failed</title><body style="font-family:system-ui;padding:2rem;max-width:36rem"><h1>DataWise could not start this connection</h1><p>${safe}</p><p>Go back to your AI assistant and try adding the DataWise connector again. If it keeps failing, report it from DataWise Settings.</p></body>`;
  return new Response(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Spec 4.2 steps 1 and 2: validate the OAuth request, remember it for ten
// minutes, and send the user to the SPA consent page. The SPA handles login
// (Google or email) and calls back into /account/authorize-request/*.
export async function handleAuthorize(request: Request, env: McpEnv): Promise<Response> {
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  let authRequest: AuthRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    if (error instanceof CimdFetchError) return localError(CIMD_UNVERIFIABLE_MESSAGE);
    if (!(error instanceof AuthorizationError)) throw error;
    if (!error.redirectUri) return localError(error.description);
    const redirect = new URL(error.redirectUri);
    redirect.searchParams.set('error', error.code);
    redirect.searchParams.set('error_description', error.description);
    if (error.state) redirect.searchParams.set('state', error.state);
    if (error.issuer) redirect.searchParams.set('iss', error.issuer);
    return Response.redirect(redirect.toString(), 302);
  }

  // parseAuthRequest above already rejected an unregistered client_id, so in
  // the normal path this second lookup only re-fetches the client to pull
  // display metadata (clientName, clientUri, logoUri) for the stash. The
  // null and CimdFetchError branches below are defense-in-depth: a CIMD
  // client's metadata document can stop resolving in the narrow window
  // between the two calls, and we still need to fail closed with a local
  // error rather than stash an incomplete client.
  let client;
  try {
    client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  } catch (error) {
    if (error instanceof CimdFetchError) return localError(CIMD_UNVERIFIABLE_MESSAGE);
    throw error;
  }
  if (!client) return localError('Unknown OAuth client.');

  const req = nonce();
  const stash: StashedAuthRequest = {
    authRequest,
    client: { clientId: client.clientId, clientName: client.clientName || new URL(authRequest.redirectUri).hostname, clientUri: client.clientUri, logoUri: client.logoUri },
    redirectUri: authRequest.redirectUri,
    createdAt: new Date().toISOString(),
  };
  await env.KV.put(`${AUTHREQ_PREFIX}${req}`, JSON.stringify(stash), { expirationTtl: AUTHREQ_TTL_SECONDS });

  const target = new URL('/connect', env.FRONTEND_URL);
  target.searchParams.set('req', req);
  return Response.redirect(target.toString(), 302);
}

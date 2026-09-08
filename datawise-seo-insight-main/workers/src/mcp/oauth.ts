import type { OAuthProviderOptions } from '@cloudflare/workers-oauth-provider';
import type { McpEnv } from './env';

// Filled in by Task 2. Kept here so test-support can import it from Task 1.
export function oauthOptions(publicUrl: string): OAuthProviderOptions<McpEnv> {
  return {
    apiRoute: '/mcp',
    apiHandler: { fetch: async () => new Response('not wired', { status: 501 }) },
    defaultHandler: { fetch: async () => new Response('not wired', { status: 501 }) },
    authorizeEndpoint: '/authorize',
    tokenEndpoint: '/oauth/token',
    clientRegistrationEndpoint: '/oauth/register',
    scopesSupported: ['read'],
    accessTokenTTL: 3600,
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: {
      // resource pins grant/token audience to /mcp (validateResourceUri
      // accepts http: and https:, so this is fine in local dev too).
      // authorization_servers is deliberately omitted: the library requires
      // https: for any explicitly configured issuer (throws otherwise, which
      // breaks local http://localhost dev and vitest) and falls back to the
      // token endpoint's own request origin when omitted, which is exactly
      // publicUrl in both dev and production.
      resource: `${publicUrl}/mcp`,
      scopes_supported: ['read'],
      resource_name: 'DataWise',
    },
  };
}

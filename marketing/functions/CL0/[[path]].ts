// Cloudflare Pages Function that decodes Resend's click-tracking URLs.
// Resend rewrites every link in transactional emails to:
//   https://www.datawiseseo.com/CL0/<urlEncodedTarget>/<segments...>/<token>=<num>
// Since the tracking subdomain is our marketing site (not a Resend tracker),
// we extract the encoded target and 302 to it.

interface Env {}

export const onRequest: PagesFunction<Env> = async ({ request }) => {
  const url = new URL(request.url);
  const match = url.pathname.match(/^\/CL0\/([^/]+)/);
  if (!match) {
    return new Response('Not Found', { status: 404 });
  }

  let target: string;
  try {
    target = decodeURIComponent(match[1]);
  } catch {
    return new Response('Bad Request: invalid encoded URL', { status: 400 });
  }

  if (!/^https?:\/\//i.test(target)) {
    return new Response('Bad Request: only http(s) targets allowed', { status: 400 });
  }

  return Response.redirect(target, 302);
};

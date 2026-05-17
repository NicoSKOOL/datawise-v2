interface FrontendOriginEnv {
  FRONTEND_URL?: string;
  MARKETING_URL?: string;
}

const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
const DATAWISE_PAGES_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.datawise-118\.pages\.dev$/i;

export function isAllowedFrontendOrigin(origin: string, env: FrontendOriginEnv): boolean {
  if (!origin) return false;
  return (
    origin === env.FRONTEND_URL ||
    origin === env.MARKETING_URL ||
    LOCALHOST_ORIGIN.test(origin) ||
    DATAWISE_PAGES_PREVIEW_ORIGIN.test(origin)
  );
}

export function getAllowedFrontendOrigin(origin: string | null, env: FrontendOriginEnv): string | null {
  const candidate = origin || '';
  return isAllowedFrontendOrigin(candidate, env) ? candidate : null;
}

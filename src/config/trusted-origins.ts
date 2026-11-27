/**
 * Config helper that lists browser origins allowed to call the API with cookies for CORS, CSRF checks, and WebSockets. It reads FRONTEND_URL, adds localhost:3000 in development, and includes any DEV_FRONTEND_ORIGINS entries.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/common/guards/csrf.guard.ts
 *   - src/config/cors-options.ts
 *   - src/modules/chat/gateways/chat.gateway.ts
 *   - src/modules/notifications/gateways/notifications.gateway.ts
 */

/** The frontend's local dev server, trusted automatically when NODE_ENV=development. */
export const LOCAL_FRONTEND_ORIGIN = 'http://localhost:3000';

type OriginEnv = {
  FRONTEND_URL?: string;
  NODE_ENV?: string;
  /** Comma-separated extra origins, e.g. "http://localhost:3000,http://127.0.0.1:3000". */
  DEV_FRONTEND_ORIGINS?: string;
};

/**
 * Origins allowed to call the API with cookies (CORS, CSRF origin check, sockets): FRONTEND_URL, plus
 * http://localhost:3000 when NODE_ENV=development, plus any listed in DEV_FRONTEND_ORIGINS.
 * DEV_FRONTEND_ORIGINS is honoured in every environment, so leave it unset on a public deployment.
 */
export function trustedOrigins(
  env: OriginEnv = process.env as OriginEnv,
): string[] {
  const origins = [
    env.FRONTEND_URL,
    env.NODE_ENV === 'development' ? LOCAL_FRONTEND_ORIGIN : undefined,
    ...(env.DEV_FRONTEND_ORIGINS ?? '').split(','),
  ]
    .map((value) => originOf(value))
    .filter((value): value is string => value !== null);
  return [...new Set(origins)];
}

function originOf(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

/**
 * Shared JWT verification settings for the auth module. It returns the allowed HS256 algorithm, issuer, and audience values read from environment variables.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/modules/auth/auth.module.ts
 *   - src/modules/auth/session/auth-session.service.ts
 *   - src/modules/auth/strategies/jwt.strategy.ts
 *   - src/modules/chat/services/chat-socket-auth.service.ts
 *   - src/modules/notifications/gateways/notifications.gateway.ts
 */

export function jwtVerifyOptions() {
  return {
    algorithms: ['HS256'] as ['HS256'],
    issuer: process.env.JWT_ISSUER ?? 'jobaura',
    audience: process.env.JWT_AUDIENCE ?? 'jobaura-api',
  };
}

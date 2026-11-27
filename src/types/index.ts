/**
 * Barrel export for shared application TypeScript types.
 * Re-exports user, auth, and API response type definitions from a single import path.
 *
 * Calls: user.types; response.types
 * Used by:
 *   - 20 files, for example src/modules/auth/services/auth.service.ts, src/modules/auth/strategies/google.strategy.ts, src/modules/auth/strategies/jwt.strategy.ts
 */

export * from './user.types';
export * from './response.types';

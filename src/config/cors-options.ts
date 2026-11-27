/**
 * Config helper that builds the CORS settings for the HTTP API. It allows credentials, sets allowed headers and HTTP methods, and exposes X-Request-ID for cross-origin browsers.
 *
 * Calls: trustedOrigins
 * Used by:
 *   - src/main.ts
 */

import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { trustedOrigins } from './trusted-origins';

/**
 * Shared CORS settings for the HTTP API.
 * Exposes X-Request-ID so cross-origin browsers can read it on error responses
 * even when a proxy or gateway returns a non-JSON 502/503 body.
 */
export function buildCorsOptions(
  origins: string[] = trustedOrigins(),
): CorsOptions {
  return {
    origin: origins,
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'sentry-trace',
      'baggage',
    ],
    exposedHeaders: ['X-Request-ID'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  };
}

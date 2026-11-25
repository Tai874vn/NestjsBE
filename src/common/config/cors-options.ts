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
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    exposedHeaders: ['X-Request-ID'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  };
}

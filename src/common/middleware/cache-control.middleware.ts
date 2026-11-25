import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

export const DEFAULT_API_CACHE_CONTROL = 'private, no-store';
export const PUBLIC_TAXONOMY_CACHE_CONTROL = 'public, max-age=300';

/**
 * Sets `Cache-Control: private, no-store` on every `/api/*` response by default.
 * Route handlers that want a different policy (such as public taxonomy routes) can set
 * their own `Cache-Control` header with `@Header(...)` or `res.setHeader(...)`.
 */
export function applyApiCacheControl(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const prefix = (process.env.GLOBAL_PREFIX || 'api').replace(/^\/+|\/+$/g, '');
  const apiBase = `/${prefix}`;
  const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
  const isApiRoute = path === apiBase || path.startsWith(`${apiBase}/`);

  if (isApiRoute && !res.getHeader('Cache-Control')) {
    res.setHeader('Cache-Control', DEFAULT_API_CACHE_CONTROL);
  }

  next();
}

@Injectable()
export class CacheControlMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    applyApiCacheControl(req, res, next);
  }
}

import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { AuthRedisService } from './auth-redis.service';

type Bucket = { count: number; resetAt: number };
const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;

@Injectable()
export class AuthRateLimitGuard implements CanActivate, OnModuleDestroy {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly redis: AuthRedisService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    if (request.method !== 'POST') return true;
    const path = (
      request.path ??
      request.originalUrl ??
      request.url ??
      ''
    ).split('?')[0];
    const operation = /^(?:\/api)?\/auth\/(signin|signup|refresh)\/?$/.exec(
      path,
    )?.[1];
    if (!operation) return true;
    const ip = request.ip || request.socket?.remoteAddress || 'unknown';
    const key = `${operation}:${createHash('sha256')
      .update(ip.length <= 256 ? ip : 'unknown')
      .digest('hex')}`;
    const limit = operation === 'refresh' ? 30 : 10;
    const allowed = await this.redis.takeRateLimit(key, limit, WINDOW_MS);
    if (allowed === true) return true;
    if (allowed === false) this.reject(http.getResponse<Response>(), WINDOW_MS);
    const retryAfter = this.consumeLocal(key, limit);
    if (retryAfter > 0) this.reject(http.getResponse<Response>(), retryAfter);
    return true;
  }

  onModuleDestroy(): void {
    this.buckets.clear();
  }

  private consumeLocal(key: string, limit: number): number {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt > now) {
      if (bucket.count >= limit) return bucket.resetAt - now;
      bucket.count += 1;
      return 0;
    }
    if (this.buckets.size >= MAX_BUCKETS) {
      for (const [id, entry] of this.buckets) {
        if (entry.resetAt <= now) this.buckets.delete(id);
      }
      if (this.buckets.size >= MAX_BUCKETS) return WINDOW_MS;
    }
    this.buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return 0;
  }

  private reject(response: Response, retryAfterMs: number): never {
    const retryAfter = Math.max(1, Math.ceil(retryAfterMs / 1000));
    response.setHeader('Retry-After', String(retryAfter));
    throw new HttpException(
      {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        code: 'RATE_LIMITED',
        message: 'Too many authentication attempts',
        retryAfter,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

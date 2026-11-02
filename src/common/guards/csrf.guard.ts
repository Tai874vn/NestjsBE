import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';

type CsrfRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  cookies?: Record<string, string | undefined>;
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const COOKIE_ISSUING_PATHS = ['/auth/signin', '/auth/signup'];

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly frontendOrigin: string;

  constructor(configService: ConfigService) {
    this.frontendOrigin = new URL(
      configService.getOrThrow<string>('FRONTEND_URL'),
    ).origin;
  }

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const request = context.switchToHttp().getRequest<CsrfRequest>();
    const method = request.method?.toUpperCase() ?? 'GET';
    if (SAFE_METHODS.has(method)) return true;

    const headers = request.headers ?? {};
    const path = request.originalUrl ?? request.url ?? '';
    const origin = this.header(headers.origin);
    if (COOKIE_ISSUING_PATHS.some((item) => path.endsWith(item))) {
      this.requireTrustedOrigin(origin);
      return true;
    }

    const cookies = request.cookies ?? {};
    const hasAuthCookie = Boolean(
      cookies.access_token || cookies.refresh_token || cookies.logout_session,
    );
    const authorization = this.header(headers.authorization);
    if (!hasAuthCookie && authorization?.startsWith('Bearer ')) return true;
    if (!hasAuthCookie) return true;

    this.requireTrustedOrigin(origin);
    const cookieToken = cookies.csrf_token;
    const headerToken = this.header(headers['x-csrf-token']);
    if (
      !cookieToken ||
      !headerToken ||
      !this.tokensMatch(cookieToken, headerToken)
    ) {
      throw new ForbiddenException('Invalid CSRF token');
    }
    return true;
  }

  private requireTrustedOrigin(origin?: string): void {
    if (origin !== this.frontendOrigin) {
      throw new ForbiddenException('Untrusted request origin');
    }
  }

  private tokensMatch(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private header(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }
}

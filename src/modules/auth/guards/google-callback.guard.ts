import { ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';

const GOOGLE_ROLE_REQUIRED_MESSAGE =
  'Account type is required for Google signup';

@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  private readonly logger = new Logger(GoogleCallbackGuard.name);

  handleRequest(
    error: unknown,
    user: unknown,
    info: unknown,
    context: ExecutionContext,
    status?: unknown,
  ): any {
    if (user) return user;

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { requestId?: string }>();
    const response = http.getResponse<Response>();
    const frontendUrl = process.env.FRONTEND_URL ?? '/';
    const message = error instanceof Error ? error.message : '';
    const redirectPath =
      message === GOOGLE_ROLE_REQUIRED_MESSAGE
        ? '/auth/login?notice=google-role-required'
        : '/auth/callback?error=auth_failed';

    if (message !== GOOGLE_ROLE_REQUIRED_MESSAGE) {
      this.logger.warn(
        JSON.stringify({
          event: 'google_oauth_failed',
          reason: this.failureReason(error, info, status),
          requestId: request.requestId,
          path: this.safePath(request),
          queryKeys: Object.keys(request.query ?? {}).sort(),
          status,
          host: request.header('host'),
          forwardedProto: request.header('x-forwarded-proto'),
          callbackUrl: process.env.GOOGLE_CALLBACK_URL,
          error: this.errorDetails(error),
          info: this.errorDetails(info),
        }),
      );
    }

    if (!response.headersSent && !response.writableEnded) {
      response.redirect(`${frontendUrl}${redirectPath}`);
    }

    return null;
  }

  private safePath(request: Request): string {
    const rawPath = request.originalUrl ?? request.url ?? request.path ?? '/';
    const [pathname, queryString] = rawPath.split('?');
    if (!queryString) return pathname;

    const query = new URLSearchParams(queryString);
    const safeQuery = new URLSearchParams();
    for (const key of ['error', 'error_description', 'state']) {
      const value = query.get(key);
      if (value) safeQuery.set(key, value.slice(0, 120));
    }

    const safeQueryString = safeQuery.toString();
    return safeQueryString ? `${pathname}?${safeQueryString}` : pathname;
  }

  private errorDetails(value: unknown): string | undefined {
    if (!value) return undefined;
    if (value instanceof Error) {
      return `${value.name}: ${value.message}`;
    }
    if (typeof value === 'object') {
      const record = value as { name?: unknown; message?: unknown };
      const name = typeof record.name === 'string' ? record.name : 'Error';
      if (typeof record.message === 'string')
        return `${name}: ${record.message}`;
    }
    if (typeof value === 'string') return value;

    try {
      const serialized = JSON.stringify(value);
      return serialized || 'Unknown error';
    } catch {
      return 'Unknown error';
    }
  }

  private failureReason(
    error: unknown,
    info: unknown,
    status: unknown,
  ): string {
    if (error) return 'strategy_error';
    if (info) return 'strategy_info';
    if (status) return 'strategy_status';
    return 'no_user_without_error';
  }
}

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { performance } from 'node:perf_hooks';
import { Observable, catchError, tap, throwError } from 'rxjs';
import {
  resolveHttpError,
  resolveRequestId,
} from '../errors/all-exceptions.filter';
import { ObservabilityService } from './observability.service';

type RequestUser = {
  id?: number;
  sub?: number | string;
  email?: string;
  role?: string;
};

type ObservableRequest = Request & {
  user?: RequestUser;
  requestId?: string;
};

const OBSERVED_ROUTES: Array<{ method: string; pattern: RegExp }> = [
  { method: 'GET', pattern: /^\/recommendations\/jobs$/ },
  {
    method: 'GET',
    pattern: /^\/recommendations\/hiring-posts\/\d+\/candidates$/,
  },
  { method: 'GET', pattern: /^\/hiring-posts$/ },
  { method: 'GET', pattern: /^\/hiring-posts\/mine$/ },
  { method: 'GET', pattern: /^\/hiring-posts\/applications\/me$/ },
  { method: 'GET', pattern: /^\/hiring-posts\/\d+$/ },
  { method: 'POST', pattern: /^\/hiring-posts$/ },
  { method: 'POST', pattern: /^\/hiring-posts\/\d+\/applications$/ },
  { method: 'GET', pattern: /^\/hiring-posts\/\d+\/applications$/ },
  { method: 'GET', pattern: /^\/users\/me\/resume$/ },
  { method: 'POST', pattern: /^\/users\/me\/resume\/file$/ },
  { method: 'GET', pattern: /^\/users\/candidates$/ },
  { method: 'GET', pattern: /^\/jobs\/paginated-search$/ },
  { method: 'GET', pattern: /^\/jobs\/details\/\d+$/ },
  { method: 'GET', pattern: /^\/posts\/feed$/ },
  { method: 'GET', pattern: /^\/notifications$/ },
  { method: 'GET', pattern: /^\/notifications\/unread-count$/ },
];

@Injectable()
export class RequestObservabilityInterceptor implements NestInterceptor {
  constructor(private readonly observability: ObservabilityService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<ObservableRequest>();
    const response = http.getResponse<Response>();
    const requestId = this.requestId(request);
    const startedAt = performance.now();

    request.requestId = requestId;
    this.setRequestIdHeader(response, requestId);

    return next.handle().pipe(
      tap(() => this.record(request, response, requestId, startedAt)),
      catchError((error: unknown) => {
        this.record(request, response, requestId, startedAt, error);
        return throwError(() => error);
      }),
    );
  }

  private record(
    request: ObservableRequest,
    response: Response,
    requestId: string,
    startedAt: number,
    error?: unknown,
  ): void {
    const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
    const statusCode = this.statusCode(response, error);
    const path = this.path(request);

    this.observability.recordHttp({
      requestId,
      method: request.method,
      path,
      statusCode,
      durationMs,
      observed: this.isObserved(request.method, path),
      userId: request.user?.id ?? request.user?.sub,
      role: request.user?.role,
      error: this.errorMessage(error),
    });
  }

  private errorMessage(error?: unknown): string | undefined {
    if (!error) return undefined;

    const response = (error as { getResponse?: () => unknown }).getResponse?.();
    if (response && typeof response === 'object') {
      const message = (response as { message?: unknown }).message;
      if (Array.isArray(message)) return message.join('; ');
      if (typeof message === 'string') return message;
    }

    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;

    return this.stringifyUnknown(error);
  }

  private stringifyUnknown(value: unknown): string {
    try {
      const serialized = JSON.stringify(value);
      return serialized || 'Unknown error';
    } catch {
      return 'Unknown error';
    }
  }

  private requestId(request: ObservableRequest): string {
    return resolveRequestId(request);
  }

  private setRequestIdHeader(response: Response, requestId: string): void {
    if (response.headersSent || response.writableEnded) return;
    response.setHeader('X-Request-ID', requestId);
  }

  private statusCode(response: Response, error?: unknown): number {
    if (error !== undefined) {
      // Use the same error resolver as AllExceptionsFilter so unhandled errors and
      // Prisma errors record their true HTTP status (500/409/404) instead of 200.
      return resolveHttpError(error).statusCode;
    }
    return response.statusCode;
  }

  private path(request: Request): string {
    return (
      request.path ||
      request.originalUrl?.split('?')[0] ||
      request.url.split('?')[0] ||
      '/'
    );
  }

  private isObserved(method: string, path: string): boolean {
    const normalizedPath = path.replace(/^\/api(\/v\d+)?/, '') || '/';
    return OBSERVED_ROUTES.some(
      (route) => route.method === method && route.pattern.test(normalizedPath),
    );
  }
}

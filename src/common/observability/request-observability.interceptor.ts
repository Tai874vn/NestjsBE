import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Observable, catchError, tap, throwError } from 'rxjs';
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
  { method: 'GET', pattern: /^\/recommendations\/jobs\/\d+\/candidates$/ },
  { method: 'GET', pattern: /^\/users\/me\/resume$/ },
  { method: 'POST', pattern: /^\/users\/me\/resume\/file$/ },
  { method: 'GET', pattern: /^\/jobs\/paginated-search$/ },
  { method: 'GET', pattern: /^\/jobs\/details\/\d+$/ },
  { method: 'GET', pattern: /^\/posts\/feed$/ },
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
    response.setHeader('X-Request-ID', requestId);

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

    return error instanceof Error ? error.message : String(error);
  }

  private requestId(request: Request): string {
    const existing = request.header('x-request-id');
    return existing?.trim() || randomUUID();
  }

  private statusCode(response: Response, error?: unknown): number {
    const errorWithStatus = error as { status?: number; getStatus?: () => number } | undefined;
    return errorWithStatus?.status ?? errorWithStatus?.getStatus?.() ?? response.statusCode;
  }

  private path(request: Request): string {
    return request.path || request.originalUrl?.split('?')[0] || request.url.split('?')[0] || '/';
  }

  private isObserved(method: string, path: string): boolean {
    const normalizedPath = path.replace(/^\/api(\/v\d+)?/, '') || '/';
    return OBSERVED_ROUTES.some(
      (route) => route.method === method && route.pattern.test(normalizedPath),
    );
  }
}

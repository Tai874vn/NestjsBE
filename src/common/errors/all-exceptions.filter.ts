import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ThrottlerException, throttlerMessage } from '@nestjs/throttler';
import { BaseWsExceptionFilter } from '@nestjs/websockets';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';

type RequestWithId = Request & { requestId?: string };

/**
 * The one JSON shape every HTTP error response uses across the backend.
 * `code` is included only when the error already carries one (for example, auth codes
 * such as ACCESS_TOKEN_EXPIRED or SESSION_REVOKED that the frontend reads).
 */
export type HttpErrorResponse = {
  statusCode: number;
  message: string | string[];
  error: string;
  code?: string;
  requestId: string;
};

export type ResolvedError = {
  statusCode: number;
  message: string | string[];
  error: string;
  code?: string;
};

export const GENERIC_SERVER_ERROR_MESSAGE =
  'Something went wrong. Please try again.';

export const RATE_LIMIT_ERROR_MESSAGE =
  'Too many requests. Please try again shortly.';

/**
 * Allowed characters and length for a caller-supplied X-Request-ID header.
 * Anything longer or containing control characters/spaces is ignored so it cannot
 * break response headers or inject lines into server logs.
 */
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/**
 * Maps Prisma known database errors (errors with a short P-code) into safe HTTP answers.
 * Only these three codes describe client-side conflicts or missing rows; every other
 * database error becomes a plain 500 so no SQL or schema details leak.
 */
const PRISMA_ERROR_MAP: Record<
  string,
  { statusCode: number; message: string }
> = {
  P2002: { statusCode: HttpStatus.CONFLICT, message: 'This already exists.' },
  P2025: { statusCode: HttpStatus.NOT_FOUND, message: 'Not found.' },
  P2003: {
    statusCode: HttpStatus.CONFLICT,
    message: 'This is still in use.',
  },
};

function statusLabel(statusCode: number): string {
  return STATUS_CODES[statusCode] ?? 'Error';
}

function internalServerError(): ResolvedError {
  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: GENERIC_SERVER_ERROR_MESSAGE,
    error: statusLabel(HttpStatus.INTERNAL_SERVER_ERROR),
  };
}

function extractMessage(
  value: unknown,
  fallbackError: string,
): string | string[] {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  return fallbackError;
}

function isExposedClientHttpError(
  value: unknown,
): value is { statusCode: number; message: string; expose: true } {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.expose === true &&
    typeof record.statusCode === 'number' &&
    record.statusCode >= 400 &&
    record.statusCode < 500 &&
    typeof record.message === 'string'
  );
}

function resolveHttpException(exception: HttpException): ResolvedError {
  const statusCode = exception.getStatus();
  const fallbackError = statusLabel(statusCode);
  const raw = exception.getResponse();

  // Never send internal or upstream details on any 5xx response.
  // Keep any safe machine-readable code (such as AUTH_UNAVAILABLE) for the frontend.
  if (statusCode >= 500) {
    let code: string | undefined;
    if (raw && typeof raw === 'object') {
      const rawCode = (raw as Record<string, unknown>).code;
      if (typeof rawCode === 'string' && rawCode.trim()) {
        code = rawCode.trim();
      }
    }
    return {
      statusCode,
      message: GENERIC_SERVER_ERROR_MESSAGE,
      error: fallbackError,
      code,
    };
  }

  // Replace NestJS ThrottlerException's default message so the class name never leaks.
  if (exception instanceof ThrottlerException) {
    const rawMessage = typeof raw === 'string' ? raw.trim() : '';
    const message =
      !rawMessage ||
      rawMessage === throttlerMessage ||
      rawMessage.startsWith('ThrottlerException:')
        ? RATE_LIMIT_ERROR_MESSAGE
        : rawMessage;
    return {
      statusCode,
      message,
      error: fallbackError,
    };
  }

  if (typeof raw === 'string') {
    return {
      statusCode,
      message: raw || fallbackError,
      error: fallbackError,
    };
  }

  if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const message = extractMessage(record.message, fallbackError);
    const error =
      typeof record.error === 'string' && record.error.trim()
        ? record.error
        : fallbackError;
    const code =
      typeof record.code === 'string' && record.code.trim()
        ? record.code
        : undefined;
    return { statusCode, message, error, code };
  }

  return {
    statusCode,
    message: exception.message || fallbackError,
    error: fallbackError,
  };
}

/**
 * Shared resolver that turns any thrown value into its HTTP status and safe response body.
 * Used by both AllExceptionsFilter and RequestObservabilityInterceptor so telemetry and HTTP
 * responses always agree on the status code.
 */
export function resolveHttpError(exception: unknown): ResolvedError {
  if (exception instanceof HttpException) {
    return resolveHttpException(exception);
  }

  if (exception instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = PRISMA_ERROR_MAP[exception.code];
    if (mapped) {
      return {
        statusCode: mapped.statusCode,
        message: mapped.message,
        error: statusLabel(mapped.statusCode),
      };
    }
    return internalServerError();
  }

  // Express body-parser (the middleware that reads JSON request bodies) throws plain HTTP
  // client errors (like 400 invalid JSON or 413 payload too large) with `expose: true`.
  if (isExposedClientHttpError(exception)) {
    return {
      statusCode: exception.statusCode,
      message: exception.message || statusLabel(exception.statusCode),
      error: statusLabel(exception.statusCode),
    };
  }

  return internalServerError();
}

export function normalizeRequestId(value: unknown): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return REQUEST_ID_PATTERN.test(trimmed) ? trimmed : undefined;
}

/**
 * Picks a safe requestId from the request or its X-Request-ID header, falling back to a new UUID.
 * Shared by AllExceptionsFilter and RequestObservabilityInterceptor so both log the exact same ID.
 */
export function resolveRequestId(
  request: Partial<Pick<RequestWithId, 'requestId' | 'header' | 'headers'>>,
): string {
  const existing = normalizeRequestId(request.requestId);
  if (existing) {
    return existing;
  }
  const headerValue =
    typeof request.header === 'function'
      ? request.header('x-request-id')
      : request.headers?.['x-request-id'];
  return normalizeRequestId(headerValue) ?? randomUUID();
}

/**
 * ONE SHARED ERROR HANDLER FOR THE WHOLE BACKEND.
 *
 * An exception filter (a class NestJS calls whenever a route throws an error) sits at the end
 * of every request. Registering it with APP_FILTER in app.module.ts means every uncaught HTTP
 * error reaches this one place:
 *  - Known 4xx HttpExceptions keep their exact message (plain English text, or the ValidationPipe
 *    list of messages) and any custom `code` (like ACCESS_TOKEN_EXPIRED).
 *  - Any 5xx HttpException always sends the generic safe message (while keeping any safe `code`
 *    like AUTH_UNAVAILABLE) so internal or upstream details never leak.
 *  - Prisma P2002 / P2025 / P2003 become 409 / 404 / 409 with short safe sentences.
 *  - Any other Prisma error or unknown error becomes a 500 with no internal details (no stack
 *    trace, no SQL, no Prisma text, no file paths).
 *  - Every 5xx (server error) is logged once at ERROR level with the requestId, method, route and real stack.
 *  - WebSocket (Socket.IO real-time) and other non-HTTP contexts are left untouched.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly wsFallback = new BaseWsExceptionFilter();

  catch(exception: unknown, host: ArgumentsHost): void {
    const contextType = host.getType();
    if (contextType === 'ws') {
      // Keep NestJS's default WebSocket error handling unchanged for Socket.IO gateways.
      this.wsFallback.catch(exception, host);
      return;
    }
    if (contextType !== 'http') {
      throw exception;
    }

    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();

    const requestId = resolveRequestId(request);
    request.requestId = requestId;

    const resolved = resolveHttpError(exception);

    if (resolved.statusCode >= 500) {
      this.logServerError(request, requestId, resolved.statusCode, exception);
    }

    if (response.headersSent || response.writableEnded) {
      return;
    }

    response.setHeader('X-Request-ID', requestId);

    const body: HttpErrorResponse = {
      statusCode: resolved.statusCode,
      message: resolved.message,
      error: resolved.error,
      ...(resolved.code ? { code: resolved.code } : {}),
      requestId,
    };

    response.status(resolved.statusCode).json(body);
  }

  private logServerError(
    request: RequestWithId,
    requestId: string,
    statusCode: number,
    exception: unknown,
  ): void {
    const method = request.method ?? 'UNKNOWN';
    const route = this.routeOf(request);
    // When an HttpException wraps an underlying cause (the real error from a database or
    // external service), log that real error and its stack so debugging sees the root failure.
    const rootError =
      exception instanceof Error && exception.cause !== undefined
        ? exception.cause
        : exception;
    const detail = this.describeError(rootError);
    const stack =
      rootError instanceof Error
        ? rootError.stack
        : exception instanceof Error
          ? exception.stack
          : undefined;

    this.logger.error(
      `[${requestId}] ${method} ${route} -> ${statusCode}: ${detail}`,
      stack,
    );
  }

  private routeOf(request: RequestWithId): string {
    const raw =
      request.originalUrl?.split('?')[0] ||
      request.path ||
      request.url?.split('?')[0] ||
      '/';
    return raw;
  }

  private describeError(error: unknown): string {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return `${error.name} (${error.code}): ${error.message}`;
    }
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    if (typeof error === 'string') {
      return error;
    }
    try {
      return JSON.stringify(error) || 'Unknown error';
    } catch {
      return 'Unknown error';
    }
  }
}

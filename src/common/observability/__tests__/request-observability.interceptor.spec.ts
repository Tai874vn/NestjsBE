import {
  ArgumentsHost,
  ExecutionContext,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { lastValueFrom, of, throwError } from 'rxjs';
import { AllExceptionsFilter } from '../../errors/all-exceptions.filter';
import { ObservabilityService } from '../observability.service';
import { RequestObservabilityInterceptor } from '../request-observability.interceptor';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function prismaKnownError(code: string) {
  return new Prisma.PrismaClientKnownRequestError('Internal Prisma error', {
    code,
    clientVersion: '7.8.0',
  });
}

describe('RequestObservabilityInterceptor', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('adds a request ID and records observed heavy routes', async () => {
    const observability = { recordHttp: jest.fn() };
    const interceptor = new RequestObservabilityInterceptor(
      observability as unknown as ObservabilityService,
    );
    const request = {
      method: 'GET',
      path: '/api/recommendations/jobs',
      header: jest.fn((name: string) =>
        name === 'x-request-id' ? 'request-123' : undefined,
      ),
      user: { id: 7, role: 'USER' },
    };
    const response = {
      statusCode: 200,
      setHeader: jest.fn(),
    };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    await lastValueFrom(
      interceptor.intercept(context, { handle: () => of({ ok: true }) }),
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Request-ID',
      'request-123',
    );
    expect(request).toHaveProperty('requestId', 'request-123');
    expect(observability.recordHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: 'request-123',
        method: 'GET',
        path: '/api/recommendations/jobs',
        statusCode: 200,
        observed: true,
        userId: 7,
        role: 'USER',
      }),
    );
  });

  it('does not set the request ID header after a guard already sent the response', async () => {
    const observability = { recordHttp: jest.fn() };
    const interceptor = new RequestObservabilityInterceptor(
      observability as unknown as ObservabilityService,
    );
    const request = {
      method: 'GET',
      path: '/api/auth/google/callback',
      header: jest.fn(),
    };
    const response = {
      statusCode: 302,
      headersSent: true,
      writableEnded: false,
      setHeader: jest.fn(),
    };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    await lastValueFrom(
      interceptor.intercept(context, { handle: () => of(undefined) }),
    );

    expect(response.setHeader).not.toHaveBeenCalled();
    expect(request).toHaveProperty('requestId');
    expect(observability.recordHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        path: '/api/auth/google/callback',
        statusCode: 302,
      }),
    );
  });

  it.each([
    ['unhandled Error', new Error('boom'), 500],
    ['Prisma P2002', prismaKnownError('P2002'), 409],
    ['Prisma P2025', prismaKnownError('P2025'), 404],
    ['Prisma P2003', prismaKnownError('P2003'), 409],
    ['unmapped Prisma P2024', prismaKnownError('P2024'), 500],
  ])(
    'records the true HTTP status (%i) instead of 200 when a route throws %s',
    async (_label, thrown, expectedStatus) => {
      const observability = { recordHttp: jest.fn() };
      const interceptor = new RequestObservabilityInterceptor(
        observability as unknown as ObservabilityService,
      );
      const request = {
        method: 'POST',
        path: '/api/jobs',
        header: jest.fn(() => 'req-err-status'),
      };
      const response = {
        statusCode: 200,
        setHeader: jest.fn(),
      };
      const context = {
        getType: () => 'http',
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => response,
        }),
      } as unknown as ExecutionContext;

      await expect(
        lastValueFrom(
          interceptor.intercept(context, {
            handle: () => throwError(() => thrown),
          }),
        ),
      ).rejects.toBe(thrown);

      expect(observability.recordHttp).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'req-err-status',
          statusCode: expectedStatus,
        }),
      );
    },
  );

  it.each([
    ['over 64 chars', 'x'.repeat(65)],
    ['contains newline', 'req-1\r\nBad: header'],
    ['contains spaces', 'invalid id'],
  ])(
    'replaces an invalid x-request-id header (%s) with a UUID',
    async (_label, badHeader) => {
      const observability = { recordHttp: jest.fn() };
      const interceptor = new RequestObservabilityInterceptor(
        observability as unknown as ObservabilityService,
      );
      const request: Record<string, unknown> = {
        method: 'GET',
        path: '/api/health',
        header: jest.fn(() => badHeader),
      };
      const response = {
        statusCode: 200,
        setHeader: jest.fn(),
      };
      const context = {
        getType: () => 'http',
        switchToHttp: () => ({
          getRequest: () => request,
          getResponse: () => response,
        }),
      } as unknown as ExecutionContext;

      await lastValueFrom(
        interceptor.intercept(context, { handle: () => of({ ok: true }) }),
      );

      expect(request.requestId).toMatch(UUID_PATTERN);
      expect(request.requestId).not.toBe(badHeader);
      expect(response.setHeader).toHaveBeenCalledWith(
        'X-Request-ID',
        request.requestId,
      );
    },
  );

  it('logs a 5xx failure at ERROR level exactly once across timer.fail, interceptor, and AllExceptionsFilter', async () => {
    const errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const logSpy = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);

    const observability = new ObservabilityService();
    const interceptor = new RequestObservabilityInterceptor(observability);
    const filter = new AllExceptionsFilter();

    const request: Record<string, unknown> = {
      method: 'GET',
      path: '/api/recommendations/jobs',
      originalUrl: '/api/recommendations/jobs',
      header: jest.fn(() => 'req-once-503'),
    };
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const response = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      setHeader: jest.fn(),
      status,
    };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    const failure = new ServiceUnavailableException(
      'AI recommendation service is unavailable',
      { cause: new Error('AI service /api/v1/match/jobs returned HTTP 502') },
    );

    let caught: unknown;
    try {
      await lastValueFrom(
        interceptor.intercept(context, {
          handle: () => {
            const timer = observability.startOperation('recommendations.jobs');
            timer.fail(failure);
            return throwError(() => failure);
          },
        }),
      );
    } catch (error) {
      caught = error;
    }

    filter.catch(caught, context as unknown as ArgumentsHost);

    // Only AllExceptionsFilter logs at ERROR level, with the shared requestId.
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('[req-once-503]');
    expect(errorSpy.mock.calls[0][0]).toContain('HTTP 502');
    // Structured telemetry still runs at warn/log levels.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0][0]).toContain('"statusCode":503');
  });
});

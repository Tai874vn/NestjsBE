jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(),
}));

import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { WsException } from '@nestjs/websockets';
import { Prisma } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import {
  AllExceptionsFilter,
  GENERIC_SERVER_ERROR_MESSAGE,
  RATE_LIMIT_ERROR_MESSAGE,
} from '../all-exceptions.filter';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function createHttpHost(options?: {
  requestId?: string;
  headerRequestId?: string;
  method?: string;
  originalUrl?: string;
  headersSent?: boolean;
}) {
  const request: Record<string, unknown> = {
    method: options?.method ?? 'POST',
    originalUrl: options?.originalUrl ?? '/api/proposals?debug=1',
    path: '/api/proposals',
    url: '/api/proposals?debug=1',
    requestId: options?.requestId,
    header: jest.fn((name: string) =>
      name.toLowerCase() === 'x-request-id'
        ? options?.headerRequestId
        : undefined,
    ),
  };

  const json = jest.fn();
  const status = jest.fn(() => ({ json }));
  const setHeader = jest.fn();
  const response = {
    headersSent: options?.headersSent ?? false,
    writableEnded: false,
    setHeader,
    status,
  };

  const host = {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return { host, request, response, status, json, setHeader };
}

function prismaKnownError(code: string, message = 'Internal Prisma message') {
  return new Prisma.PrismaClientKnownRequestError(message, {
    code,
    clientVersion: '7.8.0',
  });
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new AllExceptionsFilter();
    errorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps string message and standard error label for HttpException', () => {
    const { host, status, json } = createHttpHost({ requestId: 'req-404' });

    filter.catch(new NotFoundException('User with ID 9 not found'), host);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith({
      statusCode: 404,
      message: 'User with ID 9 not found',
      error: 'Not Found',
      requestId: 'req-404',
    });
    expect(json.mock.calls[0][0]).not.toHaveProperty('code');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('keeps ValidationPipe array messages untouched', () => {
    const { host, status, json } = createHttpHost({ requestId: 'req-val' });
    const validationError = new BadRequestException({
      statusCode: 400,
      message: ['email must be an email', 'password is too short'],
      error: 'Bad Request',
    });

    filter.catch(validationError, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      message: ['email must be an email', 'password is too short'],
      error: 'Bad Request',
      requestId: 'req-val',
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('preserves custom auth error codes such as ACCESS_TOKEN_EXPIRED and SESSION_REVOKED', () => {
    const expired = createHttpHost({ requestId: 'req-exp' });
    filter.catch(
      new UnauthorizedException({
        statusCode: 401,
        code: 'ACCESS_TOKEN_EXPIRED',
        message: 'Access token is missing, invalid or expired',
      }),
      expired.host,
    );

    expect(expired.status).toHaveBeenCalledWith(401);
    expect(expired.json).toHaveBeenCalledWith({
      statusCode: 401,
      message: 'Access token is missing, invalid or expired',
      error: 'Unauthorized',
      code: 'ACCESS_TOKEN_EXPIRED',
      requestId: 'req-exp',
    });

    const revoked = createHttpHost({ requestId: 'req-rev' });
    filter.catch(
      new UnauthorizedException({
        statusCode: 401,
        code: 'SESSION_REVOKED',
        message: 'Authentication session is invalid or revoked',
      }),
      revoked.host,
    );

    expect(revoked.json).toHaveBeenCalledWith({
      statusCode: 401,
      message: 'Authentication session is invalid or revoked',
      error: 'Unauthorized',
      code: 'SESSION_REVOKED',
      requestId: 'req-rev',
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('handles HttpException created with a plain string response', () => {
    const { host, status, json } = createHttpHost({ requestId: 'req-429' });

    filter.catch(
      new HttpException(
        'Daily AI recommendation limit reached',
        HttpStatus.TOO_MANY_REQUESTS,
      ),
      host,
    );

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Daily AI recommendation limit reached',
      error: 'Too Many Requests',
      requestId: 'req-429',
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['P2002', 409, 'This already exists.', 'Conflict'],
    ['P2025', 404, 'Not found.', 'Not Found'],
    ['P2003', 409, 'This is still in use.', 'Conflict'],
  ])(
    'maps Prisma %s to %i "%s"',
    (code, expectedStatus, expectedMessage, expectedError) => {
      const { host, status, json } = createHttpHost({
        requestId: `req-${code}`,
      });

      filter.catch(prismaKnownError(code, 'Unique constraint failed on SQL'), host);

      expect(status).toHaveBeenCalledWith(expectedStatus);
      expect(json).toHaveBeenCalledWith({
        statusCode: expectedStatus,
        message: expectedMessage,
        error: expectedError,
        requestId: `req-${code}`,
      });
      expect(errorSpy).not.toHaveBeenCalled();
    },
  );

  it('maps unmapped Prisma errors to 500 without leaking Prisma or SQL details and logs once', () => {
    const { host, status, json } = createHttpHost({
      requestId: 'req-p2024',
      method: 'GET',
      originalUrl: '/api/contracts/12',
    });
    const prismaError = prismaKnownError(
      'P2024',
      'Timed out fetching a new connection from SELECT * FROM contracts',
    );

    filter.catch(prismaError, host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body).toEqual({
      statusCode: 500,
      message: 'Something went wrong. Please try again.',
      error: 'Internal Server Error',
      requestId: 'req-p2024',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('P2024');
    expect(serialized).not.toContain('SELECT');
    expect(serialized).not.toContain('Prisma');
    expect(serialized).not.toContain('stack');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('req-p2024');
    expect(errorSpy.mock.calls[0][0]).toContain('GET');
    expect(errorSpy.mock.calls[0][0]).toContain('/api/contracts/12');
    expect(errorSpy.mock.calls[0][0]).toContain('P2024');
    expect(errorSpy.mock.calls[0][1]).toEqual(prismaError.stack);
  });

  it('maps unknown errors to 500 with no internal details and logs requestId, method, route and stack', () => {
    const { host, status, json } = createHttpHost({
      requestId: 'req-500',
      method: 'DELETE',
      originalUrl: '/api/jobs/99?secret=hidden',
    });
    const unexpected = new Error(
      'SELECT * FROM jobs failed at /app/src/modules/jobs/job-mutation.service.ts:155',
    );

    filter.catch(unexpected, host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body).toEqual({
      statusCode: 500,
      message: 'Something went wrong. Please try again.',
      error: 'Internal Server Error',
      requestId: 'req-500',
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain('SELECT');
    expect(serialized).not.toContain('job-mutation.service.ts');
    expect(serialized).not.toContain('stack');

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('req-500');
    expect(errorSpy.mock.calls[0][0]).toContain('DELETE');
    expect(errorSpy.mock.calls[0][0]).toContain('/api/jobs/99');
    expect(errorSpy.mock.calls[0][0]).not.toContain('secret=hidden');
    expect(errorSpy.mock.calls[0][0]).toContain('SELECT * FROM jobs');
    expect(errorSpy.mock.calls[0][1]).toEqual(unexpected.stack);
  });

  it('keeps plain 4xx sentences containing tech skill and certification names such as C++ and Node.js', () => {
    const { host, status, json } = createHttpHost({ requestId: 'req-skills' });
    const message =
      'Choose skills from the list. Not recognised: C++, Node.js, PostgreSQL';

    filter.catch(new BadRequestException(message), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      statusCode: 400,
      message,
      error: 'Bad Request',
      requestId: 'req-skills',
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('normalizes default ThrottlerException (429) to a plain sentence without leaking the class name', () => {
    const { host, status, json } = createHttpHost({ requestId: 'req-throttle' });

    filter.catch(new ThrottlerException(), host);

    expect(status).toHaveBeenCalledWith(429);
    const body = json.mock.calls[0][0];
    expect(body).toEqual({
      statusCode: 429,
      message: RATE_LIMIT_ERROR_MESSAGE,
      error: 'Too Many Requests',
      requestId: 'req-throttle',
    });
    expect(JSON.stringify(body)).not.toContain('ThrottlerException');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('keeps a custom plain ThrottlerException message untouched', () => {
    const { host, status, json } = createHttpHost({
      requestId: 'req-throttle-custom',
    });

    filter.catch(
      new ThrottlerException('Too many sign-in attempts. Wait one minute.'),
      host,
    );

    expect(status).toHaveBeenCalledWith(429);
    expect(json).toHaveBeenCalledWith({
      statusCode: 429,
      message: 'Too many sign-in attempts. Wait one minute.',
      error: 'Too Many Requests',
      requestId: 'req-throttle-custom',
    });
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('scrubs 5xx HttpException messages to the generic message while preserving safe code and logging root cause once', () => {
    const { host, status, json } = createHttpHost({
      requestId: 'req-503',
      method: 'POST',
      originalUrl: '/api/auth/refresh',
    });
    const rootCause = new Error('ECONNREFUSED 127.0.0.1:5432');
    const exception = new ServiceUnavailableException(
      {
        statusCode: 503,
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication storage is unavailable',
      },
      { cause: rootCause },
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith({
      statusCode: 503,
      message: GENERIC_SERVER_ERROR_MESSAGE,
      error: 'Service Unavailable',
      code: 'AUTH_UNAVAILABLE',
      requestId: 'req-503',
    });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain(
      'Authentication storage',
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('ECONNREFUSED');
    expect(errorSpy.mock.calls[0][1]).toEqual(rootCause.stack);
  });

  it('scrubs custom string and error labels on 5xx HttpExceptions and logs the real message once', () => {
    const { host, status, json } = createHttpHost({
      requestId: 'req-500-http',
      method: 'POST',
      originalUrl: '/api/auth/signup',
    });
    const exception = new InternalServerErrorException({
      statusCode: 500,
      message: 'Internal database replica 10.0.0.5 failed',
      error: 'CustomInternalError',
    });

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(500);
    const body = json.mock.calls[0][0];
    expect(body).toEqual({
      statusCode: 500,
      message: GENERIC_SERVER_ERROR_MESSAGE,
      error: 'Internal Server Error',
      requestId: 'req-500-http',
    });
    expect(JSON.stringify(body)).not.toContain('10.0.0.5');
    expect(JSON.stringify(body)).not.toContain('CustomInternalError');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain('req-500-http');
    expect(errorSpy.mock.calls[0][0]).toContain('10.0.0.5');
  });

  it('creates a requestId and sets X-Request-ID when the interceptor has not run yet', () => {
    const { host, request, json, setHeader } = createHttpHost();

    filter.catch(new UnauthorizedException('Access token is missing'), host);

    const body = json.mock.calls[0][0];
    expect(body.requestId).toMatch(UUID_PATTERN);
    expect(request.requestId).toBe(body.requestId);
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', body.requestId);
  });

  it('uses a valid x-request-id header when request.requestId is missing', () => {
    const { host, json, setHeader } = createHttpHost({
      headerRequestId: 'hdr-id_42.ok',
    });

    filter.catch(new NotFoundException('Not found'), host);

    expect(json.mock.calls[0][0].requestId).toBe('hdr-id_42.ok');
    expect(setHeader).toHaveBeenCalledWith('X-Request-ID', 'hdr-id_42.ok');
  });

  it.each([
    ['over 64 characters', 'a'.repeat(65)],
    ['contains CRLF control characters', 'req-1\r\nX-Injected: true'],
    ['contains newline', 'req-1\nforged-log-line'],
    ['contains spaces', 'req 123'],
    ['contains slashes', 'req/123'],
  ])(
    'ignores an invalid x-request-id header (%s) and generates a UUID instead',
    (_label, badHeader) => {
      const { host, request, json, setHeader } = createHttpHost({
        headerRequestId: badHeader,
      });

      filter.catch(new NotFoundException('Not found'), host);

      const body = json.mock.calls[0][0];
      expect(body.requestId).toMatch(UUID_PATTERN);
      expect(body.requestId).not.toBe(badHeader);
      expect(request.requestId).toBe(body.requestId);
      expect(setHeader).toHaveBeenCalledWith('X-Request-ID', body.requestId);
    },
  );

  it('delegates WebSocket errors to Nest default WS handling without touching HTTP', () => {
    const emit = jest.fn();
    const wsHost = {
      getType: () => 'ws',
      switchToWs: () => ({
        getClient: () => ({ emit }),
        getPattern: () => 'send-message',
        getData: () => ({ roomId: 1 }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(new WsException('Invalid message'), wsHost);

    expect(emit).toHaveBeenCalledWith(
      'exception',
      expect.objectContaining({
        status: 'error',
        message: 'Invalid message',
      }),
    );
  });

  it('does not write a response if headers were already sent', () => {
    const { host, status, json } = createHttpHost({
      requestId: 'req-sent',
      headersSent: true,
    });

    filter.catch(new Error('late crash'), host);

    expect(status).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('captures 5xx errors in Sentry with requestId, method and route before sending the response', () => {
    const order: string[] = [];
    const captureMock = Sentry.captureException as jest.Mock;
    captureMock.mockImplementationOnce(() => {
      order.push('sentry');
      return 'event-1';
    });

    const { host, status, json } = createHttpHost({
      requestId: 'req-sentry-500',
      method: 'POST',
      originalUrl: '/api/contracts/42?token=hidden',
    });
    json.mockImplementationOnce(() => {
      order.push('response');
    });

    const failure = new Error('database connection dropped');
    filter.catch(failure, host);

    expect(captureMock).toHaveBeenCalledTimes(1);
    expect(captureMock).toHaveBeenCalledWith(failure, {
      tags: {
        requestId: 'req-sentry-500',
        method: 'POST',
        route: '/api/contracts/42',
      },
    });
    expect(status).toHaveBeenCalledWith(500);
    expect(order).toEqual(['sentry', 'response']);
  });

  it('never captures 4xx client errors in Sentry', () => {
    const captureMock = Sentry.captureException as jest.Mock;
    const cases: unknown[] = [
      new BadRequestException('Invalid input'),
      new UnauthorizedException('Missing token'),
      new NotFoundException('Job not found'),
      new ThrottlerException(),
      prismaKnownError('P2002', 'Duplicate key'),
    ];

    for (const err of cases) {
      const { host } = createHttpHost({ requestId: 'req-4xx' });
      filter.catch(err, host);
    }

    expect(captureMock).not.toHaveBeenCalled();
  });
});

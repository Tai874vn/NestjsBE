import { ExecutionContext, HttpException } from '@nestjs/common';
import { AuthRateLimitGuard } from '../auth-rate-limit.guard';
import { AuthRedisService } from '../auth-redis.service';

describe('AuthRateLimitGuard', () => {
  let guard: AuthRateLimitGuard;
  let redis: { takeRateLimit: jest.Mock };

  function context(
    path = '/api/auth/signin',
    ip = '192.0.2.1',
    method = 'POST',
  ) {
    const response = { setHeader: jest.fn() };
    const request = {
      path,
      ip,
      method,
      headers: { 'x-forwarded-for': 'untrusted' },
      socket: { remoteAddress: '192.0.2.2' },
    };
    const ctx = {
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;
    return { ctx, response, request };
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-11-02T00:00:00Z') });
    redis = { takeRateLimit: jest.fn().mockResolvedValue(undefined) };
    guard = new AuthRateLimitGuard(redis as unknown as AuthRedisService);
  });

  afterEach(() => {
    guard.onModuleDestroy();
    jest.useRealTimers();
  });

  it.each(['/api/auth/signin', '/api/auth/signup'])(
    'allows exactly ten attempts per IP per minute for %s during Redis outage',
    async (path) => {
      const { ctx, response } = context(path);
      for (let i = 0; i < 10; i++)
        await expect(guard.canActivate(ctx)).resolves.toBe(true);
      const error = (await guard
        .canActivate(ctx)
        .catch((value: unknown) => value)) as HttpException;
      expect(error.getStatus()).toBe(429);
      expect(error.getResponse()).toMatchObject({
        code: 'RATE_LIMITED',
        statusCode: 429,
      });
      expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
      await jest.advanceTimersByTimeAsync(60000);
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    },
  );

  it('allows thirty refresh attempts per minute in the fallback', async () => {
    const { ctx } = context('/api/auth/refresh');
    for (let i = 0; i < 30; i++)
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 429 });
    expect(redis.takeRateLimit).toHaveBeenLastCalledWith(
      expect.stringMatching(/^refresh:/),
      30,
      60000,
    );
  });

  it('keeps IPs and operations separate without trusting forwarded headers', async () => {
    const { ctx } = context();
    for (let i = 0; i < 10; i++) await guard.canActivate(ctx);
    await expect(
      guard.canActivate(context('/api/auth/signin', '192.0.2.3').ctx),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(context('/api/auth/signup').ctx),
    ).resolves.toBe(true);
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 429 });
    expect(redis.takeRateLimit.mock.calls[0][0]).not.toContain('untrusted');
  });

  it('honors a Redis rejection even when the local bucket has capacity', async () => {
    redis.takeRateLimit.mockResolvedValue(false);
    const { ctx, response } = context();
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 429 });
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '60');
  });

  it('uses Redis allow decisions without consuming the outage fallback', async () => {
    redis.takeRateLimit.mockResolvedValue(true);
    const { ctx } = context();
    for (let i = 0; i < 20; i++)
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('reports the remaining local window rounded up, not a renewed minute', async () => {
    const { ctx, response } = context();
    for (let i = 0; i < 10; i++) await guard.canActivate(ctx);
    await jest.advanceTimersByTimeAsync(15001);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(HttpException);
    expect(response.setHeader).toHaveBeenCalledWith('Retry-After', '45');
  });

  it('bounds fallback storage without evicting an exhausted live IP bucket', async () => {
    const { ctx } = context();
    for (let i = 0; i < 10; i++) await guard.canActivate(ctx);
    for (let i = 1; i < 10000; i++)
      await guard.canActivate(context('/api/auth/signin', `ip-${i}`).ctx);
    await expect(
      guard.canActivate(context('/api/auth/signin', 'overflow').ctx),
    ).rejects.toMatchObject({ status: 429 });
    await expect(guard.canActivate(ctx)).rejects.toMatchObject({ status: 429 });
    await jest.advanceTimersByTimeAsync(60000);
    await expect(
      guard.canActivate(context('/api/auth/signin', 'new-ip').ctx),
    ).resolves.toBe(true);
  });

  it('ignores non-HTTP, safe methods, logout and unrelated routes', async () => {
    await expect(
      guard.canActivate({ getType: () => 'ws' } as ExecutionContext),
    ).resolves.toBe(true);
    for (const [path, method] of [
      ['/api/auth/signin', 'GET'],
      ['/api/auth/logout', 'POST'],
      ['/api/auth/refresh/logout', 'POST'],
      ['/api/other/signin', 'POST'],
    ]) {
      await expect(
        guard.canActivate(context(path, 'ip', method).ctx),
      ).resolves.toBe(true);
    }
    expect(redis.takeRateLimit).not.toHaveBeenCalled();
  });

  it('releases fallback storage on module shutdown', async () => {
    const { ctx } = context();
    for (let i = 0; i < 10; i++) await guard.canActivate(ctx);
    guard.onModuleDestroy();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CsrfGuard } from './csrf.guard';

describe('CsrfGuard', () => {
  const guard = new CsrfGuard({
    getOrThrow: () => 'http://localhost:3001',
  } as unknown as ConfigService);

  const context = (request: Record<string, unknown>) =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    }) as unknown as ExecutionContext;

  it('allows safe requests', () => {
    expect(guard.canActivate(context({ method: 'GET' }))).toBe(true);
  });

  it('allows bearer-token API requests without a CSRF token', () => {
    expect(
      guard.canActivate(
        context({
          method: 'POST',
          headers: { authorization: 'Bearer access-token' },
          cookies: {},
          originalUrl: '/api/posts',
        }),
      ),
    ).toBe(true);
  });

  it('rejects cookie-authenticated mutations without matching origin and CSRF token', () => {
    const request = {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'x-csrf-token': 'wrong' },
      cookies: { access_token: 'access', csrf_token: 'expected' },
      originalUrl: '/api/posts',
    };

    expect(() => guard.canActivate(context(request))).toThrow(
      ForbiddenException,
    );
  });

  it('allows cookie-authenticated mutations with exact origin and matching token', () => {
    const request = {
      method: 'POST',
      headers: { origin: 'http://localhost:3001', 'x-csrf-token': 'expected' },
      cookies: { access_token: 'access', csrf_token: 'expected' },
      originalUrl: '/api/posts',
    };

    expect(guard.canActivate(context(request))).toBe(true);
  });

  it('rejects cross-origin signin requests to prevent login CSRF', () => {
    const request = {
      method: 'POST',
      headers: { origin: 'https://attacker.example' },
      cookies: {},
      originalUrl: '/api/auth/signin',
    };

    expect(() => guard.canActivate(context(request))).toThrow(
      ForbiddenException,
    );
  });
});

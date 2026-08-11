import { ExecutionContext, Logger } from '@nestjs/common';
import { GoogleCallbackGuard } from './google-callback.guard';

describe('GoogleCallbackGuard', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;

  function createContext() {
    const response = { redirect: jest.fn() };
    const request = {
      originalUrl: '/api/auth/google/callback?code=secret-code&scope=email&authuser=0',
      query: { code: 'secret-code', scope: 'email', authuser: '0' },
      requestId: 'request-123',
      header: jest.fn((name: string) => {
        if (name === 'host') return 'example.test';
        if (name === 'x-forwarded-proto') return 'https';
        return undefined;
      }),
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    return { context, request, response };
  }

  beforeEach(() => {
    jest.restoreAllMocks();
    process.env.FRONTEND_URL = 'https://example.test';
  });

  afterAll(() => {
    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it('redirects first-time Google users without a selected role back to login role selection', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const guard = new GoogleCallbackGuard();
    const { context, response } = createContext();

    const result = guard.handleRequest(
      new Error('Account type is required for Google signup'),
      null,
      null,
      context,
    );

    expect(result).toBeNull();
    expect(response.redirect).toHaveBeenCalledWith(
      'https://example.test/auth/login?notice=google-role-required',
    );
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('logs unexpected Google callback failures before redirecting to auth failed', () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const guard = new GoogleCallbackGuard();
    const { context, response } = createContext();

    const result = guard.handleRequest(
      new Error('Failed to obtain access token'),
      null,
      { message: 'invalid_grant' },
      context,
      401,
    );

    expect(result).toBeNull();
    expect(response.redirect).toHaveBeenCalledWith(
      'https://example.test/auth/callback?error=auth_failed',
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"google_oauth_failed"'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to obtain access token'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.not.stringContaining('secret-code'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"status":401'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"queryKeys":["authuser","code","scope"]'),
    );
  });

  it('returns the authenticated user when Google auth succeeds', () => {
    const guard = new GoogleCallbackGuard();
    const { context, response } = createContext();
    const user = { id: 7 };

    expect(guard.handleRequest(null, user, null, context)).toBe(user);
    expect(response.redirect).not.toHaveBeenCalled();
  });
});

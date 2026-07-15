import { ExecutionContext } from '@nestjs/common';
import { GoogleCallbackGuard } from './google-callback.guard';

describe('GoogleCallbackGuard', () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;

  function createContext() {
    const response = { redirect: jest.fn() };
    const context = {
      switchToHttp: () => ({
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    return { context, response };
  }

  beforeEach(() => {
    process.env.FRONTEND_URL = 'https://example.test';
  });

  afterAll(() => {
    process.env.FRONTEND_URL = originalFrontendUrl;
  });

  it('redirects first-time Google users without a selected role back to register', () => {
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
      'https://example.test/auth/register?notice=google-role-required',
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

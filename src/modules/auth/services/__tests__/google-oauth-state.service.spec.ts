import { UnauthorizedException } from '@nestjs/common';
import { Role } from '../../../../common/constants/roles';
import { GoogleOAuthStateService } from '../google-oauth-state.service';

describe('GoogleOAuthStateService', () => {
  const configService = {
    getOrThrow: jest.fn((key: string) =>
      key === 'JWT_SECRET' ? 's'.repeat(64) : 'test',
    ),
  };

  it('issues and consumes a browser-bound state exactly once', () => {
    const service = new GoogleOAuthStateService(configService as never);
    const response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };
    const state = service.issue(response as never, Role.EMPLOYER);
    const request = {
      query: { state },
      cookies: { google_oauth_state: state },
    };

    service.consume(request as never, response as never);

    expect(request).toMatchObject({ googleSignupRole: Role.EMPLOYER });
    expect(response.clearCookie).toHaveBeenCalledWith(
      'google_oauth_state',
      expect.objectContaining({ httpOnly: true, sameSite: 'lax' }),
    );
  });

  it('rejects a callback that is not bound to the initiating browser', () => {
    const service = new GoogleOAuthStateService(configService as never);
    const response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    };
    const state = service.issue(response as never, Role.USER);

    expect(() =>
      service.consume(
        {
          query: { state },
          cookies: { google_oauth_state: `${state}tampered` },
        } as never,
        response as never,
      ),
    ).toThrow(UnauthorizedException);
  });
});

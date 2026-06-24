import { AuthController } from './auth.controller';

describe('AuthController logout', () => {
  const authService = {
    verifyRefreshToken: jest.fn(),
    logout: jest.fn(),
  };

  function createController() {
    return new AuthController(authService as any);
  }

  function createResponse() {
    return {
      clearCookie: jest.fn(),
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
  });

  it('revokes the refresh token and clears auth cookies without requiring an access-token user', async () => {
    authService.verifyRefreshToken.mockReturnValue({ sub: 7, email: 'admin@example.com', type: 'refresh' });
    const response = createResponse();

    const result = await createController().logout(
      { cookies: { refresh_token: 'refresh-token' } } as any,
      response as any,
    );

    expect(authService.verifyRefreshToken).toHaveBeenCalledWith('refresh-token');
    expect(authService.logout).toHaveBeenCalledWith(7);
    expect(response.clearCookie).toHaveBeenCalledWith('access_token', expect.objectContaining({ path: '/' }));
    expect(response.clearCookie).toHaveBeenCalledWith('refresh_token', expect.objectContaining({ path: '/' }));
    expect(response.clearCookie).toHaveBeenCalledWith(
      'csrf_token',
      expect.objectContaining({ path: '/', httpOnly: false }),
    );
    expect(result).toEqual({ message: 'Logged out successfully' });
  });

  it('still clears browser cookies when the refresh token is already invalid', async () => {
    authService.verifyRefreshToken.mockImplementation(() => {
      throw new Error('expired');
    });
    const response = createResponse();

    await createController().logout({ cookies: { refresh_token: 'bad-token' } } as any, response as any);

    expect(authService.logout).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenCalledWith('access_token', expect.any(Object));
    expect(response.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
    expect(response.clearCookie).toHaveBeenCalledWith('csrf_token', expect.any(Object));
  });
});

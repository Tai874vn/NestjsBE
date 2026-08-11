import { AuthController } from './auth.controller';

describe('AuthController logout', () => {
  const authService = {
    signIn: jest.fn(),
    verifyRefreshToken: jest.fn(),
    refreshTokens: jest.fn(),
    logout: jest.fn(),
    googleLogin: jest.fn(),
  };

  function createController() {
    return new AuthController(authService as any);
  }

  function createResponse() {
    return {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      redirect: jest.fn(),
      headersSent: false,
      writableEnded: false,
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.JWT_EXPIRES_IN = '15m';
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

  it('clears browser cookies when refresh token verification fails', async () => {
    authService.verifyRefreshToken.mockImplementation(() => {
      throw new Error('invalid token');
    });
    const response = createResponse();

    await expect(
      createController().refresh(
        { cookies: { refresh_token: 'bad-token' } } as any,
        response as any,
      ),
    ).rejects.toThrow('invalid token');

    expect(authService.refreshTokens).not.toHaveBeenCalled();
    expect(response.clearCookie).toHaveBeenCalledWith('access_token', expect.any(Object));
    expect(response.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
    expect(response.clearCookie).toHaveBeenCalledWith('csrf_token', expect.any(Object));
  });

  it('clears browser cookies when the stored refresh token no longer matches', async () => {
    authService.verifyRefreshToken.mockReturnValue({ sub: 7, email: 'admin@example.com', type: 'refresh' });
    authService.refreshTokens.mockRejectedValue(new Error('Access Denied'));
    const response = createResponse();

    await expect(
      createController().refresh(
        { cookies: { refresh_token: 'stale-token' } } as any,
        response as any,
      ),
    ).rejects.toThrow('Access Denied');

    expect(authService.refreshTokens).toHaveBeenCalledWith(7, 'stale-token');
    expect(response.clearCookie).toHaveBeenCalledWith('access_token', expect.any(Object));
    expect(response.clearCookie).toHaveBeenCalledWith('refresh_token', expect.any(Object));
    expect(response.clearCookie).toHaveBeenCalledWith('csrf_token', expect.any(Object));
  });

  it('does not set Google auth cookies after a guard already committed the response', async () => {
    const response = {
      ...createResponse(),
      headersSent: true,
    };

    await createController().googleAuthRedirect(
      { user: { id: 7, email: 'user@example.com' } } as any,
      response as any,
    );

    expect(authService.googleLogin).not.toHaveBeenCalled();
    expect(response.cookie).not.toHaveBeenCalled();
    expect(response.redirect).not.toHaveBeenCalled();
  });

  it('sets Google auth cookies and redirects when the callback succeeds', async () => {
    const response = createResponse();
    authService.googleLogin.mockResolvedValue({
      token: 'access-token',
      refreshToken: 'refresh-token',
    });
    process.env.FRONTEND_URL = 'https://example.test';

    await createController().googleAuthRedirect(
      { user: { id: 7, email: 'user@example.com' } } as any,
      response as any,
    );

    expect(authService.googleLogin).toHaveBeenCalledWith({
      id: 7,
      email: 'user@example.com',
    });
    expect(response.cookie).toHaveBeenCalledWith(
      'access_token',
      'access-token',
      expect.any(Object),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'refresh_token',
      'refresh-token',
      expect.any(Object),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'csrf_token',
      expect.any(String),
      expect.any(Object),
    );
    expect(response.redirect).toHaveBeenCalledWith('https://example.test/auth/callback');
  });

  it('uses JWT_EXPIRES_IN for the access-token cookie lifetime', async () => {
    const response = createResponse();
    process.env.JWT_EXPIRES_IN = '2h';
    authService.signIn.mockResolvedValue({
      message: 'Login successful',
      content: {
        token: 'access-token',
        refreshToken: 'refresh-token',
        user: { id: 7, email: 'user@example.com' },
      },
    });

    await createController().signIn(
      { email: 'user@example.com', password: 'password123' } as any,
      response as any,
    );

    expect(response.cookie).toHaveBeenCalledWith(
      'access_token',
      'access-token',
      expect.objectContaining({ maxAge: 2 * 60 * 60 * 1000 }),
    );
  });
});

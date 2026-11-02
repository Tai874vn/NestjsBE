import { randomBytes } from 'crypto';
import { Response } from 'express';
import ms, { StringValue } from 'ms';

function cookiePaths() {
  const prefix = (process.env.GLOBAL_PREFIX ?? 'api').replace(/^\/+|\/+$/g, '');
  const base = prefix ? `/${prefix}/auth` : '/auth';
  return { refresh: `${base}/refresh`, logout: `${base}/logout` };
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
  };
}

export function setAuthCookies(
  res: Response,
  access: string,
  refresh: string,
  logout?: string,
  expiresAt?: Date,
) {
  const paths = cookiePaths();
  const options = cookieOptions();
  const configuredMaxAge =
    Number(process.env.AUTH_REFRESH_TTL_DAYS ?? 14) * 86_400_000;
  const refreshMaxAge = expiresAt
    ? Math.max(0, Math.min(configuredMaxAge, expiresAt.getTime() - Date.now()))
    : configuredMaxAge;
  // Remove the old root-scoped refresh cookie before introducing its narrow path.
  res.clearCookie('refresh_token', { ...options, path: '/' });
  res.cookie('access_token', access, {
    ...options,
    path: '/',
    maxAge: ms((process.env.JWT_EXPIRES_IN ?? '10m') as StringValue),
  });
  res.cookie('refresh_token', refresh, {
    ...options,
    path: paths.refresh,
    maxAge: refreshMaxAge,
  });
  if (logout)
    res.cookie('logout_session', logout, {
      ...options,
      path: paths.logout,
      maxAge: refreshMaxAge,
    });
  res.cookie('csrf_token', randomBytes(32).toString('base64url'), {
    ...options,
    httpOnly: false,
    path: '/',
    maxAge: refreshMaxAge,
  });
}

export function clearAuthCookies(res: Response) {
  const options = cookieOptions();
  res.clearCookie('access_token', { ...options, path: '/' });
  res.clearCookie('refresh_token', { ...options, path: '/' });
  res.clearCookie('refresh_token', { ...options, path: cookiePaths().refresh });
  res.clearCookie('logout_session', { ...options, path: cookiePaths().logout });
  res.clearCookie('csrf_token', { ...options, httpOnly: false, path: '/' });
}

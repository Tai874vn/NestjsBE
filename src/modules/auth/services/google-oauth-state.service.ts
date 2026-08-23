import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { Role } from '../../../common/constants/roles';

const OAUTH_STATE_COOKIE = 'google_oauth_state';
const OAUTH_STATE_MAX_AGE_MS = 10 * 60 * 1000;

type OAuthStatePayload = {
  nonce: string;
  issuedAt: number;
  role?: Role.USER | Role.EMPLOYER;
};

export type GoogleOAuthRequest = Request & {
  googleSignupRole?: Role.USER | Role.EMPLOYER;
};

@Injectable()
export class GoogleOAuthStateService {
  private readonly secret: string;
  private readonly secureCookies: boolean;

  constructor(configService: ConfigService) {
    this.secret = configService.getOrThrow<string>('JWT_SECRET');
    this.secureCookies =
      configService.getOrThrow<string>('NODE_ENV') === 'production';
  }

  issue(response: Response, role?: Role.USER | Role.EMPLOYER): string {
    const payload: OAuthStatePayload = {
      nonce: randomBytes(32).toString('base64url'),
      issuedAt: Date.now(),
      ...(role ? { role } : {}),
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString(
      'base64url',
    );
    const state = `${encodedPayload}.${this.sign(encodedPayload)}`;

    response.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: 'lax',
      path: '/',
      maxAge: OAUTH_STATE_MAX_AGE_MS,
    });

    return state;
  }

  consume(request: GoogleOAuthRequest, response: Response): void {
    const queryState = this.singleValue(request.query.state);
    const rawCookieState: unknown = request.cookies?.[OAUTH_STATE_COOKIE];
    const cookieState =
      typeof rawCookieState === 'string' ? rawCookieState : undefined;
    this.clear(response);

    if (
      !queryState ||
      !cookieState ||
      !this.valuesMatch(queryState, cookieState)
    ) {
      throw new UnauthorizedException('Invalid or expired Google OAuth state');
    }

    const payload = this.verify(queryState);
    if (Date.now() - payload.issuedAt > OAUTH_STATE_MAX_AGE_MS) {
      throw new UnauthorizedException('Invalid or expired Google OAuth state');
    }

    request.googleSignupRole = payload.role;
  }

  private verify(state: string): OAuthStatePayload {
    const [encodedPayload, providedSignature, extra] = state.split('.');
    if (!encodedPayload || !providedSignature || extra) {
      throw new UnauthorizedException('Invalid or expired Google OAuth state');
    }

    const expectedSignature = this.sign(encodedPayload);
    if (!this.valuesMatch(providedSignature, expectedSignature)) {
      throw new UnauthorizedException('Invalid or expired Google OAuth state');
    }

    try {
      const parsed = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as Partial<OAuthStatePayload>;
      if (
        typeof parsed.nonce !== 'string' ||
        parsed.nonce.length < 32 ||
        typeof parsed.issuedAt !== 'number' ||
        (parsed.role !== undefined &&
          parsed.role !== Role.USER &&
          parsed.role !== Role.EMPLOYER)
      ) {
        throw new Error('Invalid state payload');
      }
      return parsed as OAuthStatePayload;
    } catch {
      throw new UnauthorizedException('Invalid or expired Google OAuth state');
    }
  }

  private sign(value: string): string {
    return createHmac('sha256', this.secret).update(value).digest('base64url');
  }

  private valuesMatch(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return (
      leftBuffer.length === rightBuffer.length &&
      timingSafeEqual(leftBuffer, rightBuffer)
    );
  }

  private clear(response: Response): void {
    response.clearCookie(OAUTH_STATE_COOKIE, {
      httpOnly: true,
      secure: this.secureCookies,
      sameSite: 'lax',
      path: '/',
    });
  }

  private singleValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }
}

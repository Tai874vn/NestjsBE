import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  Req,
  Res,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import * as express from 'express';
import { AuthService } from '../services/auth.service';
import { SignUpDto } from '../dto/signup.dto';
import { SignInDto } from '../dto/signin.dto';
import { GoogleCallbackGuard } from '../guards/google-callback.guard';
import { GoogleAuthGuard } from '../guards/google-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';

const DEFAULT_ACCESS_TOKEN_MAX_AGE_MS = 15 * 60 * 1000;
const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private setAuthCookies(
    res: express.Response,
    accessToken: string,
    refreshToken: string,
  ): void {
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('access_token', accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: this.accessTokenCookieMaxAgeMs(),
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    });

    res.cookie('csrf_token', randomBytes(32).toString('base64url'), {
      httpOnly: false,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    });
  }

  private clearAuthCookies(res: express.Response): void {
    const isProduction = process.env.NODE_ENV === 'production';
    const options = {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax' as const,
      path: '/',
    };

    res.clearCookie('access_token', options);
    res.clearCookie('refresh_token', options);
    res.clearCookie('csrf_token', {
      ...options,
      httpOnly: false,
    });
  }

  private isResponseCommitted(res: express.Response): boolean {
    return res.headersSent || res.writableEnded;
  }

  private accessTokenCookieMaxAgeMs(): number {
    return (
      this.durationToMs(process.env.JWT_EXPIRES_IN) ??
      DEFAULT_ACCESS_TOKEN_MAX_AGE_MS
    );
  }

  private durationToMs(value?: string): number | undefined {
    const match = value?.trim().match(/^(\d+)\s*(ms|s|m|h|d)$/i);
    if (!match) return undefined;

    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers: Record<string, number> = {
      ms: 1,
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    const duration = amount * multipliers[unit];
    return Number.isSafeInteger(duration) && duration > 0
      ? duration
      : undefined;
  }

  @Public()
  @Post('signup')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signUp(
    @Body() signUpDto: SignUpDto,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const result = await this.authService.signUp(signUpDto);

    if (!result.content) {
      throw new InternalServerErrorException('Signup failed');
    }

    this.setAuthCookies(res, result.content.token, result.content.refreshToken);

    return {
      message: result.message,
      content: { user: result.content.user },
    };
  }

  @Public()
  @Post('signin')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signIn(
    @Body() signInDto: SignInDto,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const result = await this.authService.signIn(signInDto);

    if (!result.content) {
      throw new InternalServerErrorException('Signin failed');
    }

    this.setAuthCookies(res, result.content.token, result.content.refreshToken);

    return {
      message: result.message,
      content: { user: result.content.user },
    };
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  async googleAuth() {
    // Guard redirects to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleCallbackGuard)
  async googleAuthRedirect(
    @Req() req: express.Request,
    @Res() res: express.Response,
  ) {
    if (!req.user || this.isResponseCommitted(res)) return;

    const result = await this.authService.googleLogin(req.user);

    if (this.isResponseCommitted(res)) return;

    this.setAuthCookies(res, result.token, result.refreshToken);

    const frontendUrl = process.env.FRONTEND_URL;
    res.redirect(`${frontendUrl}/auth/callback`);
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  getCurrentUser(@Req() req: express.Request) {
    if (!req.user) {
      throw new UnauthorizedException('User not authenticated');
    }
    return this.authService.getCurrentUser(req.user.id);
  }

  @Public()
  @Post('refresh')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async refresh(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const refreshToken = req.cookies?.refresh_token;
    if (typeof refreshToken !== 'string') {
      this.clearAuthCookies(res);
      throw new UnauthorizedException('Refresh token not found');
    }

    try {
      const payload = this.authService.verifyRefreshToken(refreshToken);

      const tokens = await this.authService.refreshTokens(
        payload.sub,
        refreshToken,
      );

      this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

      return {
        message: 'Tokens refreshed successfully',
      };
    } catch (error) {
      this.clearAuthCookies(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  async logout(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const refreshToken = req.cookies?.refresh_token;
    if (typeof refreshToken === 'string') {
      try {
        const payload = this.authService.verifyRefreshToken(refreshToken);
        await this.authService.logout(payload.sub);
      } catch {
        // The browser cookies should still be cleared even if the server token is stale.
      }
    }

    this.clearAuthCookies(res);

    return {
      message: 'Logged out successfully',
    };
  }
}

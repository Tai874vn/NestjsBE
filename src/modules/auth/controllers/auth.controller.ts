import {
  Body,
  Controller,
  Get,
  HttpException,
  InternalServerErrorException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import * as express from 'express';
import { AuthService } from '../services/auth.service';
import { SignUpDto } from '../dto/signup.dto';
import { SignInDto } from '../dto/signin.dto';
import { GoogleCallbackGuard } from '../guards/google-callback.guard';
import { GoogleAuthGuard } from '../guards/google-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { AuthRateLimitGuard } from '../session/auth-rate-limit.guard';
import { clearAuthCookies, setAuthCookies } from '../session/auth-cookies';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private metadata(req?: express.Request) {
    return { userAgent: req?.headers?.['user-agent'], ip: req?.ip };
  }

  @Public()
  @Post('signup')
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signUp(
    @Body() dto: SignUpDto,
    @Res({ passthrough: true }) res: express.Response,
    @Req() req?: express.Request,
  ) {
    const result = await this.authService.signUp(dto, this.metadata(req));
    if (!result.content)
      throw new InternalServerErrorException('Signup failed');
    setAuthCookies(
      res,
      result.content.token,
      result.content.refreshToken,
      result.content.logoutToken,
      result.content.refreshExpiresAt,
    );
    return { message: result.message, content: { user: result.content.user } };
  }

  @Public()
  @Post('signin')
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async signIn(
    @Body() dto: SignInDto,
    @Res({ passthrough: true }) res: express.Response,
    @Req() req?: express.Request,
  ) {
    const result = await this.authService.signIn(dto, this.metadata(req));
    if (!result.content)
      throw new InternalServerErrorException('Signin failed');
    setAuthCookies(
      res,
      result.content.token,
      result.content.refreshToken,
      result.content.logoutToken,
      result.content.refreshExpiresAt,
    );
    return { message: result.message, content: { user: result.content.user } };
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {}

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleCallbackGuard)
  async googleAuthRedirect(
    @Req() req: express.Request,
    @Res() res: express.Response,
  ) {
    if (!req.user || res.headersSent || res.writableEnded) return;
    const result = await this.authService.googleLogin(
      req.user,
      this.metadata(req),
    );
    if (res.headersSent || res.writableEnded) return;
    setAuthCookies(
      res,
      result.token,
      result.refreshToken,
      result.logoutToken,
      result.refreshExpiresAt,
    );
    res.redirect(`${process.env.FRONTEND_URL}/auth/callback`);
  }

  @Get('me')
  getCurrentUser(@Req() req: express.Request) {
    if (!req.user) throw new UnauthorizedException('User not authenticated');
    return this.authService.getCurrentUser(req.user.id);
  }

  @Public()
  @Post('refresh')
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async refresh(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    try {
      const token = req.cookies?.refresh_token;
      if (typeof token !== 'string')
        throw new UnauthorizedException({
          statusCode: 401,
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Refresh token not found',
        });
      const result = await this.authService.refreshTokens(token);
      setAuthCookies(
        res,
        result.accessToken,
        result.refreshToken,
        result.logoutToken,
        result.refreshExpiresAt,
      );
      return { message: 'Tokens refreshed successfully' };
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 401)
        clearAuthCookies(res);
      throw error;
    }
  }

  @Public()
  @Post(['logout', 'refresh/logout'])
  @UseGuards(AuthRateLimitGuard)
  async logout(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const refresh =
      typeof req.cookies?.refresh_token === 'string'
        ? req.cookies.refresh_token
        : undefined;
    const logout =
      typeof req.cookies?.logout_session === 'string'
        ? req.cookies.logout_session
        : undefined;
    await this.authService.logout(refresh, logout);
    clearAuthCookies(res);
    return { message: 'Logged out successfully' };
  }
}

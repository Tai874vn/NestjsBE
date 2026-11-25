import {
  Body,
  Controller,
  Get,
  HttpCode,
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
import {
  EmailOnlyDto,
  EmailTokenDto,
  ResetPasswordDto,
} from '../dto/email-flows.dto';
import { EmailVerificationService } from '../services/email-verification.service';
import { PasswordResetService } from '../services/password-reset.service';
import { GoogleCallbackGuard } from '../guards/google-callback.guard';
import { GoogleAuthGuard } from '../guards/google-auth.guard';
import { Public } from '../../../common/decorators/public.decorator';
import { AuthRateLimitGuard } from '../session/auth-rate-limit.guard';
import { clearAuthCookies, setAuthCookies } from '../session/auth-cookies';

/**
 * LOGIN FLOW — the web addresses under /api/auth.
 *
 * A controller (the class that receives web requests and sends answers) only
 * reads the request and writes cookies. The real work is in AuthService.
 *
 * How a user stays logged in:
 *  1. Sign in / Google login (sign-up first needs the mailed link) → the server creates a "session"
 *     (one row per logged-in browser) and returns three cookies
 *     (small values the browser stores and sends back automatically):
 *       - access_token  : a JWT (JSON Web Token, a signed ticket that says
 *                         "user 5, role USER"). Lives 10 minutes. Sent on
 *                         every request so the server knows who you are.
 *       - refresh_token : a long random string. Lives 14 days. Only sent to
 *                         /auth/refresh, to get a new access_token.
 *       - logout_session: lets /auth/logout end the session even if the
 *                         refresh token is gone.
 *     All three are httpOnly (JavaScript in the page cannot read them), so a
 *     script injected into the page cannot steal them.
 *  2. Each request → JwtStrategy checks the access_token (see jwt.strategy.ts).
 *  3. After 10 minutes the access_token expires → the frontend calls
 *     /auth/refresh → it gets a new pair of tokens (the old refresh token can
 *     never be used again; see AuthSessionService.refresh).
 *  4. Logout → the session is marked revoked (cancelled) and cookies are cleared.
 */
/** The answer to "send me a link": the same whether or not the address has an account. */
const SENT_IF_EXISTS =
  'If an account uses this email, we have sent it a link. Check your inbox and spam folder.';

@Controller('auth')
export class AuthController {
  // Constructor (the function that runs once when the class is created).
  // NestJS "injects" (passes in automatically) the AuthService for us.
  constructor(
    private readonly authService: AuthService,
    private readonly emailVerification: EmailVerificationService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  /** Browser name and IP address, saved with the session so a user can see "where am I logged in". */
  private metadata(req?: express.Request) {
    return { userAgent: req?.headers?.['user-agent'], ip: req?.ip };
  }

  // The lines starting with @ are decorators (labels that add behaviour):
  //  @Public()     → no login needed for this address.
  //  @Post(...)    → answers HTTP POST /api/auth/signup.
  //  @UseGuards / @Throttle → rate limit (at most 5 tries per minute), to slow
  //                  down password guessing.
  /** Create an account and mail the confirm link. No cookies: sign-in works after the link is opened. */
  @Public()
  @Post('signup')
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  signUp(@Body() dto: SignUpDto) {
    return this.authService.signUp(dto);
  }

  /** Open the confirm link (the page posts the token from `#token=`). */
  @Public()
  @Post('verify-email')
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async verifyEmail(@Body() dto: EmailTokenDto) {
    const { email } = await this.emailVerification.verify(dto.token);
    return {
      message: 'Email confirmed. You can sign in now.',
      content: { email },
    };
  }

  /** Mail the confirm link again. Same answer for every address (see EmailVerificationService). */
  @Public()
  @Post('verify-email/resend')
  @HttpCode(202)
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  resendVerification(@Body() dto: EmailOnlyDto) {
    this.emailVerification.resendForEmail(dto.email);
    return { message: SENT_IF_EXISTS };
  }

  /** Mail a reset link. Same answer for every address (see PasswordResetService). */
  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  forgotPassword(@Body() dto: EmailOnlyDto) {
    this.passwordReset.request(dto.email);
    return { message: SENT_IF_EXISTS };
  }

  /** Set a new password with the mailed token. Signs out every device; the user signs in again. */
  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @UseGuards(AuthRateLimitGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwordReset.reset(dto.token, dto.password);
    return { message: 'Password changed. Sign in with your new password.' };
  }

  /** Email + password login. On success the browser receives the login cookies. */
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

  /**
   * Google login, step 1: the guard sends the browser to Google's login page.
   * The function body is empty on purpose — the guard does all the work.
   */
  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  googleAuth() {}

  /**
   * Google login, step 2: Google sends the browser back here with a one-time
   * code. GoogleCallbackGuard swaps that code for the user's Google profile and
   * finds or creates our user (google.strategy.ts). Then we create a session,
   * set the cookies and send the browser back to the frontend.
   */
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

  /** Who am I? No @Public(), so the access_token is checked first; req.user is filled by JwtStrategy. */
  @Get('me')
  getCurrentUser(@Req() req: express.Request) {
    if (!req.user) throw new UnauthorizedException('User not authenticated');
    return this.authService.getCurrentUser(req.user.id);
  }

  /**
   * Swap the refresh_token cookie for a fresh access_token + refresh_token.
   * The frontend calls this automatically when a request fails with 401
   * (401 = "not logged in / token expired"). If the refresh token is bad, the
   * cookies are deleted, so the user is logged out cleanly.
   */
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

  /** End this browser's session on the server, then delete the cookies. */
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

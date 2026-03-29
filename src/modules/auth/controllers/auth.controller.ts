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
import { AuthGuard } from '@nestjs/passport';
import * as express from 'express';
import { AuthService } from '../services/auth.service';
import { SignUpDto } from '../dto/signup.dto';
import { SignInDto } from '../dto/signin.dto';
import { Public } from '../../../common/decorators/public.decorator';

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
      maxAge: 15 * 60 * 1000, // 15 minutes
    });

    res.cookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });
  }

  @Public()
  @Post('signup')
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
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    // Guard redirects to Google
  }

  @Public()
  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthRedirect(
    @Req() req: express.Request,
    @Res() res: express.Response,
  ) {
    if (!req.user) {
      throw new UnauthorizedException('User not authenticated');
    }
    const result = await this.authService.googleLogin(req.user);

    this.setAuthCookies(res, result.token, result.refreshToken);

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
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
  async refresh(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    const refreshToken = req.cookies?.refresh_token;
    if (typeof refreshToken !== 'string') {
      throw new UnauthorizedException('Refresh token not found');
    }

    const payload = this.authService.verifyRefreshToken(refreshToken);

    const tokens = await this.authService.refreshTokens(
      payload.sub,
      refreshToken,
    );

    this.setAuthCookies(res, tokens.accessToken, tokens.refreshToken);

    return {
      message: 'Tokens refreshed successfully',
    };
  }

  @Post('logout')
  async logout(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    if (req.user) {
      await this.authService.logout(req.user.id);
    }

    res.clearCookie('access_token');
    res.clearCookie('refresh_token');

    return {
      message: 'Logged out successfully',
    };
  }
}

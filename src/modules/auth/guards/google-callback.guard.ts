import { ExecutionContext, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Response } from 'express';

const GOOGLE_ROLE_REQUIRED_MESSAGE = 'Account type is required for Google signup';

@Injectable()
export class GoogleCallbackGuard extends AuthGuard('google') {
  handleRequest(
    error: unknown,
    user: unknown,
    _info: unknown,
    context: ExecutionContext,
  ): any {
    if (user) return user;

    const response = context.switchToHttp().getResponse<Response>();
    const frontendUrl = process.env.FRONTEND_URL ?? '/';
    const message = error instanceof Error ? error.message : '';
    const redirectPath =
      message === GOOGLE_ROLE_REQUIRED_MESSAGE
        ? '/auth/register?notice=google-role-required'
        : '/auth/callback?error=auth_failed';

    response.redirect(`${frontendUrl}${redirectPath}`);
    return null;
  }
}

/**
 * Common global JWT auth guard that requires a valid access token on HTTP routes unless marked `@Public()`.
 * Allows anonymous access on `@OptionalAuth()` routes when no token is sent, and returns structured 401 codes for missing, expired, or invalid tokens.
 *
 * Calls: JwtStrategy (via Passport 'jwt')
 * Used by:
 *   - 26 files, for example src/app.module.ts, src/modules/admin/controllers/admin.controller.ts, src/modules/categories/controllers/categories.controller.ts
 */

import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  handleRequest<TUser = any>(
    error: any,
    user: TUser,
    info: any,
    context?: ExecutionContext,
  ): TUser {
    if (error) throw error;
    // A visitor with no token is anonymous on optional routes. A token that is sent but expired or invalid is
    // still rejected, so the client refreshes it instead of silently browsing signed out.
    if (
      !user &&
      info?.message === 'No auth token' &&
      context &&
      this.isOptional(context)
    ) {
      return null as TUser;
    }
    if (!user) {
      const code =
        info?.name === 'TokenExpiredError'
          ? 'ACCESS_TOKEN_EXPIRED'
          : info?.message === 'No auth token'
            ? 'ACCESS_TOKEN_MISSING'
            : 'INVALID_ACCESS_TOKEN';
      throw new UnauthorizedException({
        statusCode: 401,
        code,
        message: 'Access token is missing, invalid or expired',
      });
    }
    return user;
  }

  private isOptional(context: ExecutionContext) {
    return Boolean(
      this.reflector.getAllAndOverride<boolean>('optionalAuth', [
        context.getHandler(),
        context.getClass(),
      ]),
    );
  }

  canActivate(context: ExecutionContext) {
    if (context.getType() !== 'http') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }
}

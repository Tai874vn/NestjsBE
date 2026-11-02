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

  handleRequest<TUser = any>(error: any, user: TUser, info: any): TUser {
    if (error) throw error;
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

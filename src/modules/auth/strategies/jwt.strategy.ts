import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { JwtPayload, ValidatedUser } from '../../../types';
import { Role } from '../../../common/constants/roles';
import { AuthSessionService } from '../session/auth-session.service';
import { jwtVerifyOptions } from '../session/auth-jwt.config';

type JwtRequest = Request & { validatedJwtUser?: ValidatedUser };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly sessions: AuthSessionService) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET environment variable is required');
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => request?.cookies?.access_token,
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKey: secret,
      ...jwtVerifyOptions(),
    });
  }

  async validate(
    request: JwtRequest,
    payload: JwtPayload,
  ): Promise<ValidatedUser> {
    if (
      payload.type !== 'access' ||
      !Number.isInteger(payload.sub) ||
      payload.sub <= 0 ||
      !UUID.test(payload.sid ?? '') ||
      !UUID.test(payload.jti ?? '') ||
      !Object.values(Role).includes(payload.role as Role) ||
      !Number.isInteger(payload.ver)
    ) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'INVALID_ACCESS_TOKEN',
        message: 'Invalid access token',
      });
    }
    if (
      request.validatedJwtUser?.id === payload.sub &&
      request.validatedJwtUser.sessionId === payload.sid
    )
      return request.validatedJwtUser;
    await this.sessions.assertAccessSession(
      payload.sid!,
      payload.sub,
      payload.jti,
    );
    const user: ValidatedUser = {
      id: payload.sub,
      role: payload.role as Role,
      sessionId: payload.sid,
    };
    request.validatedJwtUser = user;
    return user;
  }
}

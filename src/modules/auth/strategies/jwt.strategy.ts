import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { PrismaService } from '../../../prisma.service';
import { JwtPayload, ValidatedUser } from '../../../types';
import { Role } from '../../../common/constants/roles';

type JwtRequest = Request & { validatedJwtUser?: ValidatedUser };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: Request) => {
          // First try to get token from cookie
          return request?.cookies?.access_token;
        },
        // Fallback to Authorization header for backward compatibility
        ExtractJwt.fromAuthHeaderAsBearerToken(),
      ]),
      ignoreExpiration: false,
      passReqToCallback: true,
      secretOrKey: (() => {
        const secret = process.env.JWT_SECRET;
        if (!secret) {
          throw new Error('JWT_SECRET environment variable is required');
        }
        return secret;
      })(),
    });
  }

  async validate(
    request: JwtRequest,
    payload: JwtPayload,
  ): Promise<ValidatedUser> {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('Invalid access token');
    }

    if (request.validatedJwtUser?.id === payload.sub) {
      return request.validatedJwtUser;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        role: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException();
    }

    if (!Object.values(Role).includes(user.role as Role)) {
      throw new UnauthorizedException();
    }

    const validatedUser = {
      ...user,
      role: user.role as Role,
    };
    request.validatedJwtUser = validatedUser;
    return validatedUser;
  }
}

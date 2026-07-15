import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { User } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { GoogleProfile } from '../../../types';
import { Role } from '../../../common/constants/roles';

type UserType = User;

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private prisma: PrismaService,
    configService: ConfigService,
  ) {
    super({
      clientID: configService.getOrThrow<string>('GOOGLE_CLIENT_ID'),
      clientSecret: configService.getOrThrow<string>('GOOGLE_CLIENT_SECRET'),
      callbackURL: configService.getOrThrow<string>('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
      passReqToCallback: true,
    });
  }

  async validate(
    req: Request,
    accessToken: string,
    refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback,
  ): Promise<void> {
    const { id, emails, displayName, photos } = profile;
    const signupRole = this.getSignupRole(req.query.state);

    let user: UserType | null = await this.prisma.user.findUnique({
      where: { googleId: id },
    });

    if (!user) {
      const existingUser: UserType | null = await this.prisma.user.findUnique({
        where: { email: emails[0].value },
      });

      if (existingUser) {
        user = await this.prisma.user.update({
          where: { id: existingUser.id },
          data: { googleId: id },
        });
      } else {
        if (!signupRole) {
          done(
            new UnauthorizedException('Account type is required for Google signup'),
            false,
          );
          return;
        }

        user = await this.prisma.user.create({
          data: {
            googleId: id,
            email: emails[0].value,
            name: displayName,
            avatar: photos?.[0]?.value,
            role: signupRole,
          },
        });
      }
    }

    done(null, user);
  }

  private getSignupRole(state: unknown): Role.USER | Role.EMPLOYER | undefined {
    if (state === Role.USER || state === Role.EMPLOYER) return state;
    return undefined;
  }
}

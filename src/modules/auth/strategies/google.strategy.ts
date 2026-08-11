import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Request } from 'express';
import { Strategy } from 'passport-google-oauth20';
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
  ): Promise<UserType> {
    const { id, emails, displayName, photos } = profile;
    const email = this.normalizeEmail(emails?.[0]?.value);
    if (!email) {
      throw new UnauthorizedException('Google account email is required');
    }

    const signupRole = this.getSignupRole(req.query.state);

    let user: UserType | null = await this.prisma.user.findUnique({
      where: { googleId: id },
    });

    if (!user) {
      const existingUser: UserType | null = await this.findUserByEmail(email);

      if (existingUser) {
        user = await this.prisma.user.update({
          where: { id: existingUser.id },
          data: { googleId: id },
        });
      } else {
        if (!signupRole) {
          throw new UnauthorizedException(
            'Account type is required for Google signup',
          );
        }

        user = await this.prisma.user.create({
          data: {
            googleId: id,
            email,
            name: this.displayNameFor(displayName, email),
            avatar: photos?.[0]?.value,
            role: signupRole,
          },
        });
      }
    }

    return user;
  }

  private getSignupRole(state: unknown): Role.USER | Role.EMPLOYER | undefined {
    if (state === Role.USER || state === Role.EMPLOYER) return state;
    return undefined;
  }

  private normalizeEmail(value?: string): string | undefined {
    const email = value?.trim().toLowerCase();
    return email || undefined;
  }

  private displayNameFor(value: string | undefined, email: string): string {
    return value?.trim() || email.split('@')[0] || 'JobAura member';
  }

  private findUserByEmail(email: string): Promise<UserType | null> {
    const normalizedEmail = this.normalizeEmail(email);
    return this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      orderBy: { id: 'asc' },
    });
  }
}

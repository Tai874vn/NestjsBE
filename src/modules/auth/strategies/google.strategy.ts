import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
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
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: GoogleProfile,
    done: VerifyCallback,
  ): Promise<void> {
    const { id, emails, displayName, photos } = profile;

    let user: UserType | null = await this.prisma.user.findUnique({
      where: { googleId: id },
    });

    if (!user) {
      const existingUser: UserType | null =
        await this.prisma.user.findUnique({
          where: { email: emails[0].value },
        });

      if (existingUser) {
        user = await this.prisma.user.update({
          where: { id: existingUser.id },
          data: { googleId: id },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            googleId: id,
            email: emails[0].value,
            name: displayName,
            avatar: photos?.[0]?.value,
            role: Role.USER,
          },
        });
      }
    }

    done(null, user);
  }
}

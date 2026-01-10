import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { GoogleProfile } from '../../../types';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type NguoiDungType = Prisma.NguoiDungGetPayload<{}>;

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private prisma: PrismaService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL ||
        'http://localhost:3000/api/auth/google/callback',
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

    let user: NguoiDungType | null = await this.prisma.nguoiDung.findUnique({
      where: { googleId: id },
    });

    if (!user) {
      const existingUser: NguoiDungType | null =
        await this.prisma.nguoiDung.findUnique({
          where: { email: emails[0].value },
        });

      if (existingUser) {
        user = await this.prisma.nguoiDung.update({
          where: { id: existingUser.id },
          data: { googleId: id },
        });
      } else {
        user = await this.prisma.nguoiDung.create({
          data: {
            googleId: id,
            email: emails[0].value,
            name: displayName,
            avatar: photos?.[0]?.value,
            role: 'user',
          },
        });
      }
    }

    done(null, user);
  }
}

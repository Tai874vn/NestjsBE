/**
 * Passport Google OAuth 2.0 strategy for the auth module.
 * It checks Google profiles after sign-in and links or creates a local user account.
 *
 * Calls: Google OAuth (passport-google-oauth20); prisma.user
 * Used by:
 *   - src/modules/auth/auth.module.ts
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-google-oauth20';
import { User } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { GoogleProfile } from '../../../types';
import { GoogleOAuthRequest } from '../services/google-oauth-state.service';

type UserType = User;

/**
 * GOOGLE LOGIN using OAuth 2.0 (a standard way to "log in with another
 * website" without ever seeing the user's Google password).
 *
 * Passport is a login library; a "strategy" is one way to log in.
 * The constructor tells Passport our app's Google id/secret and the address
 * Google must send the user back to (callbackURL). We only ask Google for the
 * user's email and basic profile (scope).
 */
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

  /**
   * Runs after Google confirmed the user. Turns the Google profile into OUR user:
   *  1. Already linked to this Google account? → use that user.
   *  2. Same email already registered with a password? → link Google to it.
   *  3. Brand new? → create the user with the role they picked on the sign-up
   *     page (candidate or recruiter). Without a role we refuse.
   * The returned user becomes req.user in AuthController.googleAuthRedirect.
   */
  async validate(
    req: GoogleOAuthRequest,
    accessToken: string,
    refreshToken: string,
    profile: GoogleProfile,
  ): Promise<UserType> {
    const { id, emails, displayName, photos } = profile;
    const email = this.normalizeEmail(emails?.[0]?.value);
    if (!email) {
      throw new UnauthorizedException('Google account email is required');
    }
    // Google marks addresses it has not checked; those must not open an account by email.
    if (
      (profile as { _json?: { email_verified?: boolean } })._json
        ?.email_verified === false
    ) {
      throw new UnauthorizedException('Google has not verified this email');
    }

    const signupRole = req.googleSignupRole;

    let user: UserType | null = await this.prisma.user.findUnique({
      where: { googleId: id },
    });

    if (!user) {
      const existingUser: UserType | null = await this.findUserByEmail(email);

      if (existingUser) {
        // An address nobody has proved yet may have been signed up by someone else, waiting
        // for the real owner to log in with Google (account pre-hijacking). Google proves the
        // owner, so that unknown password is dropped; the owner can add one with "forgot password".
        const unproved = existingUser.emailVerifiedAt === null;
        user = await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            googleId: id,
            ...(unproved
              ? { password: null, emailVerifiedAt: new Date() }
              : {}),
          },
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
            candidateDiscoverable: true,
            // Google has checked the address.
            emailVerifiedAt: new Date(),
          },
        });
      }
    }

    return user;
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

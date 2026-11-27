/**
 * Auth feature module for login, registration, email verification, password reset, Google OAuth, sessions, and realtime tickets. It imports ConfigModule, AuthSessionRedisModule, MailModule, PassportModule, and JwtModule, registers its controllers and providers, and exports AuthService, AuthSessionService, EmailVerificationService, and JwtModule.
 *
 * Calls: AuthSessionRedisModule; MailModule; jwtVerifyOptions; AuthController; AuthSessionsController; RealtimeTicketController; AuthService; AuthSessionService
 * Used by:
 *   - src/app.module.ts
 *   - src/modules/chat/chat.module.ts
 *   - src/modules/notifications/notifications.module.ts
 *   - src/modules/users/users.module.ts
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { StringValue } from 'ms';
import { AuthService } from './services/auth.service';
import { AuthController } from './controllers/auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { GoogleStrategy } from './strategies/google.strategy';
import { GoogleCallbackGuard } from './guards/google-callback.guard';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { GoogleOAuthStateService } from './services/google-oauth-state.service';
import { RealtimeTicketController } from './controllers/realtime-ticket.controller';
import { RealtimeTicketService } from './services/realtime-ticket.service';
import { AuthSessionService } from './session/auth-session.service';
import { AuthSessionRedisModule } from './session/auth-session-redis.module';
import { AuthRateLimitGuard } from './session/auth-rate-limit.guard';
import { AuthSessionsController } from './controllers/auth-sessions.controller';
import { jwtVerifyOptions } from './session/auth-jwt.config';
import { MailModule } from '../mail/mail.module';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';

@Module({
  imports: [
    ConfigModule,
    AuthSessionRedisModule,
    MailModule,
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.getOrThrow<StringValue>('JWT_EXPIRES_IN'),
          algorithm: 'HS256',
          issuer: jwtVerifyOptions().issuer,
          audience: jwtVerifyOptions().audience,
        },
      }),
    }),
  ],
  controllers: [
    AuthController,
    RealtimeTicketController,
    AuthSessionsController,
  ],
  providers: [
    AuthService,
    AuthSessionService,
    AuthRateLimitGuard,
    JwtStrategy,
    GoogleStrategy,
    GoogleAuthGuard,
    GoogleCallbackGuard,
    GoogleOAuthStateService,
    RealtimeTicketService,
    EmailVerificationService,
    PasswordResetService,
  ],
  exports: [
    AuthService,
    AuthSessionService,
    EmailVerificationService,
    JwtModule,
  ],
})
export class AuthModule {}

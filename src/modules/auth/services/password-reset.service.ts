import { Injectable, Logger } from '@nestjs/common';
import { EmailTokenPurpose } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { AccountEmailsService } from '../../mail/account-emails.service';
import { EmailTokensService } from '../../mail/email-tokens.service';
import { AuthSessionService } from '../session/auth-session.service';
import { invalidLink } from './email-verification.service';

/**
 * "Forgot password" by mail.
 * - request(): same answer for every address, and the work runs in the background, so neither
 *   the answer nor its timing shows whether the address has an account.
 * - reset(): the link works once, for 30 minutes, and signs out every device.
 * A Google-only account (no password yet) can use it to add a password.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: EmailTokensService,
    private readonly mails: AccountEmailsService,
    private readonly sessions: AuthSessionService,
  ) {}

  request(email: string): void {
    void this.requestInBackground(email).catch((error: Error) =>
      this.logger.error(`Password reset mail failed: ${error.message}`),
    );
  }

  async reset(token: string, newPassword: string): Promise<void> {
    const row = await this.tokens.consume(
      token,
      EmailTokenPurpose.RESET_PASSWORD,
    );
    if (!row) throw invalidLink();
    const user = await this.prisma.user.findUnique({
      where: { id: row.userId },
    });
    // A link sent before the address changed (or before a ban) no longer works.
    if (
      !user ||
      user.bannedAt ||
      user.email.toLowerCase() !== row.email.toLowerCase()
    ) {
      throw invalidLink();
    }
    await this.sessions.resetPassword(user.id, newPassword, row.email);
  }

  private async requestInBackground(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
      orderBy: { id: 'asc' },
    });
    if (!user || user.bannedAt) return;
    if (
      !(await this.mails.canSendAgain(
        user.id,
        EmailTokenPurpose.RESET_PASSWORD,
      ))
    )
      return;
    await this.mails.sendPasswordReset(user, user.email);
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { EmailTokenPurpose } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { AccountEmailsService } from '../../mail/services/account-emails.service';
import { EmailTokensService } from '../../mail/services/email-tokens.service';

export const LINK_INVALID_MESSAGE =
  'This link is not valid or has expired. Ask for a new one.';

export function invalidLink(): BadRequestException {
  return new BadRequestException({
    code: 'EMAIL_LINK_INVALID',
    message: LINK_INVALID_MESSAGE,
  });
}

/**
 * Proving that a user owns an email address.
 * - New password accounts must open the mailed link before they can sign in.
 * - A user who changes their address keeps the old one until the link sent to the new one is opened.
 * - Google accounts are proved by Google (google.strategy.ts).
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: EmailTokensService,
    private readonly mails: AccountEmailsService,
  ) {}

  /** Open the link: verifies the address, or switches to the pending new address. */
  async verify(token: string): Promise<{ email: string }> {
    return this.prisma.$transaction(async (tx) => {
      const row = await this.tokens.consume(
        token,
        EmailTokenPurpose.VERIFY_EMAIL,
        tx,
      );
      if (!row) throw invalidLink();
      const user = await tx.user.findUnique({ where: { id: row.userId } });
      if (!user || user.bannedAt) throw invalidLink();

      if (user.pendingEmail && user.pendingEmail === row.email) {
        // Someone may have taken the address after the link was sent.
        const taken = await tx.user.findFirst({
          where: {
            id: { not: user.id },
            email: { equals: row.email, mode: 'insensitive' },
          },
          select: { id: true },
        });
        if (taken)
          throw new ConflictException(
            'This email is already used by another account.',
          );
        await tx.user.update({
          where: { id: user.id },
          data: {
            email: row.email,
            pendingEmail: null,
            emailVerifiedAt: new Date(),
          },
        });
        return { email: row.email };
      }
      if (user.email.toLowerCase() === row.email.toLowerCase()) {
        if (!user.emailVerifiedAt) {
          await tx.user.update({
            where: { id: user.id },
            data: { emailVerifiedAt: new Date() },
          });
        }
        return { email: user.email };
      }
      // The address changed again after this link was sent: the link is for an old address.
      throw invalidLink();
    });
  }

  /**
   * "Send the link again", asked from the sign-in page. Same answer whether or not the address
   * has an account, so nobody can use it to find out who is signed up. It runs in the
   * background, so the answer time gives nothing away either.
   */
  resendForEmail(email: string): void {
    void this.resendInBackground(email).catch((error: Error) =>
      this.logger.error(`Resend verification failed: ${error.message}`),
    );
  }

  /** Sign-up: the first link. Waits for the mail so the page can say if it failed. */
  sendFirst(user: { id: number; name: string; email: string }) {
    return this.mails.sendVerification(user, user.email);
  }

  /** A signed-in user changes their address: the new one stays pending until its link is opened. */
  async requestEmailChange(
    userId: number,
    newEmail: string,
  ): Promise<{ pendingEmail: string; mailSent: boolean }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    const taken = await this.prisma.user.findFirst({
      where: {
        id: { not: userId },
        email: { equals: newEmail, mode: 'insensitive' },
      },
      select: { id: true },
    });
    if (taken) throw new ConflictException('Email already exists');
    await this.prisma.user.update({
      where: { id: userId },
      data: { pendingEmail: newEmail },
    });
    const mailSent = await this.mails.sendVerification(user, newEmail);
    return { pendingEmail: newEmail, mailSent };
  }

  private async resendInBackground(email: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: {
        OR: [
          { email: { equals: email, mode: 'insensitive' } },
          { pendingEmail: { equals: email, mode: 'insensitive' } },
        ],
      },
      orderBy: { id: 'asc' },
    });
    if (!user || user.bannedAt) return;
    let target: string | null = null;
    if (user.pendingEmail?.toLowerCase() === email.toLowerCase())
      target = user.pendingEmail;
    else if (!user.emailVerifiedAt) target = user.email;
    if (!target) return;
    if (
      !(await this.mails.canSendAgain(user.id, EmailTokenPurpose.VERIFY_EMAIL))
    )
      return;
    await this.mails.sendVerification(user, target);
  }
}

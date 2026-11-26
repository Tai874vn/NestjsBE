import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailTokenPurpose } from '@prisma/client';
import { EmailTokensService } from './email-tokens.service';
import { MailService } from './mail.service';
import { resetPasswordMail, verifyEmailMail } from '../utils/mail-templates';

export const VERIFY_EMAIL_TTL_MS = 24 * 60 * 60 * 1000;
export const RESET_PASSWORD_TTL_MS = 30 * 60 * 1000;
/** At most one mail of each kind per user per minute. */
export const RESEND_COOLDOWN_MS = 60 * 1000;

type Recipient = { id: number; name: string };

/**
 * The account mails: "confirm your email" and "reset your password".
 * The token goes after `#` in the link. The part after `#` is never sent to a server, so the
 * token is not written to nginx/Cloudflare logs and not leaked in the Referer header.
 */
@Injectable()
export class AccountEmailsService {
  constructor(
    private readonly tokens: EmailTokensService,
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  async sendVerification(user: Recipient, email: string): Promise<boolean> {
    const token = await this.tokens.issue({
      userId: user.id,
      purpose: EmailTokenPurpose.VERIFY_EMAIL,
      email,
      ttlMs: VERIFY_EMAIL_TTL_MS,
    });
    const mail = verifyEmailMail(
      user.name,
      this.link('/auth/verify-email', token),
      VERIFY_EMAIL_TTL_MS / 60_000,
    );
    return this.mail.send({ to: email, ...mail, kind: 'verify-email' });
  }

  async sendPasswordReset(user: Recipient, email: string): Promise<boolean> {
    const token = await this.tokens.issue({
      userId: user.id,
      purpose: EmailTokenPurpose.RESET_PASSWORD,
      email,
      ttlMs: RESET_PASSWORD_TTL_MS,
    });
    const mail = resetPasswordMail(
      user.name,
      this.link('/auth/reset-password', token),
      RESET_PASSWORD_TTL_MS / 60_000,
    );
    return this.mail.send({ to: email, ...mail, kind: 'reset-password' });
  }

  /** True when the last mail of this kind is older than the cooldown. */
  async canSendAgain(
    userId: number,
    purpose: EmailTokenPurpose,
    now = new Date(),
  ): Promise<boolean> {
    const last = await this.tokens.lastIssuedAt(userId, purpose);
    return !last || now.getTime() - last.getTime() >= RESEND_COOLDOWN_MS;
  }

  private link(path: string, token: string): string {
    const base = this.config
      .getOrThrow<string>('FRONTEND_URL')
      .replace(/\/+$/, '');
    return `${base}${path}#token=${token}`;
  }
}

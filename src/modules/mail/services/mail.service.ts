import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Sentry from '@sentry/nestjs';

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Resend tag, e.g. "verify-email". Lets the Resend dashboard group mails by kind. */
  kind: string;
};

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/**
 * Sends mail with Resend's HTTP API (no SDK: one POST is all we need).
 *
 * It never throws. A mail that fails is logged and sent to Sentry, and the caller gets `false`.
 * Why: sign-up and "forgot password" must answer the same way whether or not the mail went out,
 * and the user can always ask for the link again.
 *
 * Without RESEND_API_KEY (local runs, tests) nothing is sent.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.config.get<string>('RESEND_API_KEY'));
  }

  async send(message: MailMessage): Promise<boolean> {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (!apiKey) {
      this.logger.warn(
        `Mail not sent (RESEND_API_KEY is not set): ${message.kind}`,
      );
      return false;
    }
    const from =
      this.config.get<string>('MAIL_FROM') ??
      'JobAura <no-reply@mail.jobaura.site>';
    try {
      const response = await fetch(RESEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          tags: [{ name: 'kind', value: message.kind }],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        // Resend's error body names the problem (e.g. "domain is not verified"); it holds no secret.
        const body = (await response.text()).slice(0, 300);
        throw new Error(`Resend answered ${response.status}: ${body}`);
      }
      return true;
    } catch (error) {
      // The address is not logged: the kind is enough to find the problem.
      this.logger.error(
        `Mail failed (${message.kind}): ${(error as Error).message}`,
      );
      Sentry.captureException(error, {
        tags: { context: 'mail.send', kind: message.kind },
      });
      return false;
    }
  }
}

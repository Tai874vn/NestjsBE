import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import * as Sentry from '@sentry/nestjs';
import type { Request } from 'express';
import { Public } from '../../../common/decorators/public.decorator';
import {
  StripeService,
  WebhookSignatureError,
} from '../services/stripe.service';
import { TopUpsService } from '../services/top-ups.service';

/**
 * Stripe's webhook: Stripe's server POSTs signed events here.
 * No sign-in: the Stripe-Signature header (HMAC of the raw body with the endpoint secret) proves
 * it is Stripe. main.ts keeps the raw body for this path, because the signature covers the exact bytes.
 * - bad or old signature → 400 (Stripe shows it as a failed delivery);
 * - handled (credited, duplicate, wrong amount, other event types) → 200, so Stripe stops retrying;
 * - our own error (e.g. database down) → 500, so Stripe retries later.
 */
@Controller('payments/stripe')
export class StripeController {
  private readonly logger = new Logger(StripeController.name);

  constructor(
    private readonly topUps: TopUpsService,
    private readonly stripe: StripeService,
  ) {}

  @Public()
  @SkipThrottle()
  @Post('webhook')
  @HttpCode(200)
  async webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') signature: string | undefined,
  ) {
    if (!this.stripe.isConfigured() || !req.rawBody) {
      throw new BadRequestException('Webhook not accepted');
    }
    let event;
    try {
      event = this.stripe.verifyWebhook(req.rawBody, signature);
    } catch (error) {
      if (
        error instanceof WebhookSignatureError ||
        error instanceof SyntaxError
      ) {
        throw new BadRequestException('Invalid signature');
      }
      throw error;
    }
    const outcome = await this.topUps
      .handleEvent(event)
      .catch((error: Error) => {
        this.logger.error(
          `Stripe webhook ${event.id} failed: ${error.message}`,
        );
        Sentry.captureException(error, { tags: { context: 'stripe.webhook' } });
        throw error;
      });
    if (outcome === 'amount_mismatch' || outcome === 'not_found') {
      this.logger.warn(
        `Stripe webhook ${event.id} (${event.type}): ${outcome}`,
      );
      Sentry.captureMessage(`Stripe webhook ${outcome}`, {
        level: 'warning',
        tags: { context: 'stripe.webhook' },
      });
    }
    return { received: true };
  }
}

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import * as Sentry from '@sentry/nestjs';
import { Public } from '../../../common/decorators/public.decorator';
import { SepayService } from '../sepay.service';
import { TopUpsService } from '../top-ups.service';
import type { SepayIpn } from '../top-ups.service';

/**
 * SePay's IPN (Instant Payment Notification): SePay's server POSTs the payment result here.
 * No sign-in: the X-Secret-Key header (the IPN key set in my.sepay.vn) proves it is SePay.
 * - wrong or missing key → 401;
 * - handled (credited, already done, unknown order, wrong amount) → 200 { success: true }, so
 *   SePay does not send it again; a wrong amount is logged and sent to Sentry;
 * - our own error (e.g. database down) → 500, so SePay can try again later.
 */
@Controller('payments/sepay')
export class SepayController {
  private readonly logger = new Logger(SepayController.name);

  constructor(
    private readonly topUps: TopUpsService,
    private readonly sepay: SepayService,
  ) {}

  @Public()
  @SkipThrottle()
  @Post('ipn')
  @HttpCode(200)
  async ipn(
    @Headers('x-secret-key') secretKey: string | undefined,
    @Body() body: SepayIpn,
  ) {
    if (!this.sepay.ipnSecretMatches(secretKey)) {
      throw new UnauthorizedException('Invalid IPN key');
    }
    const invoice = String(body?.order?.order_invoice_number ?? '?');
    const outcome = await this.topUps.handleIpn(body).catch((error: Error) => {
      // Only the invoice number is logged, never the key.
      this.logger.error(`SePay IPN failed for ${invoice}: ${error.message}`);
      Sentry.captureException(error, { tags: { context: 'sepay.ipn' } });
      throw error;
    });
    if (outcome === 'amount_mismatch' || outcome === 'not_found') {
      this.logger.warn(`SePay IPN for ${invoice}: ${outcome}`);
      Sentry.captureMessage(`SePay IPN ${outcome}`, {
        level: 'warning',
        tags: { context: 'sepay.ipn' },
      });
    }
    return { success: true };
  }
}

import { Controller, Get, HttpCode, Logger, Query } from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { Public } from '../../../common/decorators/public.decorator';
import { IPN_MESSAGES, TopUpsService } from '../top-ups.service';

/**
 * VNPay's IPN (Instant Payment Notification: VNPay's server calls us with the signed result).
 * No sign-in: the signature (vnp_SecureHash) proves the call is from VNPay.
 * It always answers 200 with VNPay's JSON, e.g. { RspCode: '00', Message: 'Confirm Success' };
 * VNPay calls again later for 01, 04, 97 and 99.
 */
@Controller('payments/vnpay')
export class VnpayController {
  private readonly logger = new Logger(VnpayController.name);

  constructor(private readonly topUps: TopUpsService) {}

  @Public()
  @Get('ipn')
  @HttpCode(200)
  async ipn(@Query() query: Record<string, string>) {
    try {
      const { code } = await this.topUps.complete(query);
      return { RspCode: code, Message: IPN_MESSAGES[code] };
    } catch (error) {
      // Only the ref is logged, never the hash or the secret.
      this.logger.error(
        `VNPay IPN failed for ${String(query.vnp_TxnRef)}: ${(error as Error).message}`,
      );
      Sentry.captureException(error, {
        tags: { context: 'vnpay.ipn' },
      });
      return { RspCode: '99', Message: IPN_MESSAGES['99'] };
    }
  }
}

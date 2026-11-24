import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ValidatedUser } from '../../../types';
import { TopUpDto } from '../dto/top-up.dto';
import { WalletLedgerQueryDto } from '../dto/wallet-ledger-query.dto';
import { TopUpsService } from '../top-ups.service';
import { vnpayIpAddr } from '../vnpay.service';
import { WalletService } from '../wallet.service';

/**
 * The signed-in user's own demo wallet (any role). Every answer is { message, content }.
 * The wallet is made, with its 5,000-credit starting grant, on the first call.
 */
@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly topUps: TopUpsService,
  ) {}

  @Get()
  async summary(@CurrentUser() user: ValidatedUser) {
    return {
      message: 'Wallet fetched',
      content: await this.wallet.summary(user.id),
    };
  }

  // Newest first.
  @Get('ledger')
  async ledger(
    @CurrentUser() user: ValidatedUser,
    @Query() query: WalletLedgerQueryDto,
  ) {
    return {
      message: 'Wallet ledger fetched',
      content: await this.wallet.ledger(user.id, query.page, query.pageSize),
    };
  }

  /** Starts a VNPay sandbox top-up; the frontend sends the browser to payUrl. 503 when VNPay is not set up. */
  @Post('top-ups')
  async startTopUp(
    @CurrentUser() user: ValidatedUser,
    @Body() dto: TopUpDto,
    @Req() req: Request,
  ) {
    return {
      message: 'Top up started',
      content: await this.topUps.start(user.id, dto.credits, vnpayIpAddr(req)),
    };
  }

  /**
   * The frontend's return page sends every vnp_* param it got back from VNPay here. It finishes
   * the top-up the same way the IPN does (credits are added at most once).
   */
  @Get('top-ups/vnpay-return')
  async vnpayReturn(
    @CurrentUser() user: ValidatedUser,
    @Query() query: Record<string, string>,
  ) {
    return {
      message: 'Top up checked',
      content: await this.topUps.finishReturn(user.id, query),
    };
  }
}

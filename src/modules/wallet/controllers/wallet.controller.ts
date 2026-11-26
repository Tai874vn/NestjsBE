import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ValidatedUser } from '../../../types';
import { TopUpDto } from '../dto/top-up.dto';
import { WalletLedgerQueryDto } from '../dto/wallet-ledger-query.dto';
import { TopUpsService } from '../services/top-ups.service';
import { WalletService } from '../services/wallet.service';

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

  /**
   * Starts a Stripe Checkout (test mode) top-up. The frontend sends the browser to checkoutUrl.
   * 503 when Stripe is not set up.
   */
  @Post('top-ups')
  async startTopUp(@CurrentUser() user: ValidatedUser, @Body() dto: TopUpDto) {
    return {
      message: 'Top up started',
      content: await this.topUps.start(user.id, dto.credits),
    };
  }

  /** The return page asks this until the top-up is PAID (or gives up after a while). */
  @Get('top-ups/:id')
  async topUpStatus(
    @CurrentUser() user: ValidatedUser,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return {
      message: 'Top up checked',
      content: await this.topUps.status(user.id, id),
    };
  }
}

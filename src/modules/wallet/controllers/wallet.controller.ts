import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ValidatedUser } from '../../../types';
import { WalletLedgerQueryDto } from '../dto/wallet-ledger-query.dto';
import { WalletService } from '../wallet.service';

/**
 * The signed-in user's own demo wallet (any role). Both answers are { message, content }.
 * The wallet is made, with its 5,000-credit starting grant, on the first call.
 */
@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

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
}

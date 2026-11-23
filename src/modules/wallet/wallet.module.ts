import { Module } from '@nestjs/common';
import { WalletController } from './controllers/wallet.controller';
import { WalletService } from './wallet.service';

/**
 * Demo credit wallets: balances, the ledger (every credit move) and the money steps that the
 * proposal, contract, sweeper and top-up code run inside their own transactions (WalletService).
 */
@Module({
  controllers: [WalletController],
  providers: [WalletService],
  exports: [WalletService],
})
export class WalletModule {}

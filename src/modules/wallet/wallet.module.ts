import { Module } from '@nestjs/common';
import { SepayController } from './controllers/sepay.controller';
import { WalletController } from './controllers/wallet.controller';
import { TopUpsService } from './top-ups.service';
import { SepayService } from './sepay.service';
import { WalletService } from './wallet.service';

/**
 * Demo credit wallets: balances, the ledger (every credit move) and the money steps that the
 * proposal, contract, sweeper and top-up code run inside their own transactions (WalletService).
 * Top-ups go through the SePay sandbox (TopUpsService, SepayService); they are off while the
 * SePay env keys are missing.
 */
@Module({
  controllers: [WalletController, SepayController],
  providers: [WalletService, SepayService, TopUpsService],
  exports: [WalletService],
})
export class WalletModule {}

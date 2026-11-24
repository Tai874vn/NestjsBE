import { Module } from '@nestjs/common';
import { VnpayController } from './controllers/vnpay.controller';
import { WalletController } from './controllers/wallet.controller';
import { TopUpsService } from './top-ups.service';
import { VnpayService } from './vnpay.service';
import { WalletService } from './wallet.service';

/**
 * Demo credit wallets: balances, the ledger (every credit move) and the money steps that the
 * proposal, contract, sweeper and top-up code run inside their own transactions (WalletService).
 * Top-ups go through the VNPay sandbox (TopUpsService, VnpayService); they are off while the
 * VNPay env keys are missing.
 */
@Module({
  controllers: [WalletController, VnpayController],
  providers: [WalletService, VnpayService, TopUpsService],
  exports: [WalletService],
})
export class WalletModule {}

import { Module } from '@nestjs/common';
import { StripeController } from './controllers/stripe.controller';
import { WalletController } from './controllers/wallet.controller';
import { TopUpsService } from './services/top-ups.service';
import { StripeService } from './services/stripe.service';
import { WalletService } from './services/wallet.service';

/**
 * Demo credit wallets: balances, the ledger (every credit move) and the money steps that the
 * proposal, contract, sweeper and top-up code run inside their own transactions (WalletService).
 * Top-ups go through Stripe Checkout in test mode (TopUpsService, StripeService); they are off
 * while the Stripe test keys are missing.
 */
@Module({
  controllers: [WalletController, StripeController],
  providers: [WalletService, StripeService, TopUpsService],
  exports: [WalletService],
})
export class WalletModule {}

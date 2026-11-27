/**
 * Top-up credit pricing constants for the wallet module (Stripe Checkout test mode).
 * Sets 1 credit to 5 US cents (so 10 credits meets Stripe's 0.50 USD minimum) in a shared file to avoid a circular import between WalletService and TopUpsService.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/modules/wallet/services/top-ups.service.ts
 *   - src/modules/wallet/services/wallet.service.ts
 */

export const TOP_UP_CURRENCY = 'usd';
export const CENTS_PER_CREDIT = 5;

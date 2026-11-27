/**
 * What one demo credit costs in Stripe Checkout (test mode). Kept in its own file so the wallet service and the
 * top-up service can both import it without importing each other (a circular import breaks Nest's injection).
 * 1 credit = 5 US cents, so the 10-credit minimum is Stripe's 0.50 USD minimum charge.
 */
export const TOP_UP_CURRENCY = 'usd';
export const CENTS_PER_CREDIT = 5;

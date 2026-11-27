/**
 * Stripe test-mode client and webhook signature verifier for the wallet module.
 * Creates and fetches Stripe Checkout Sessions over HTTP and checks Stripe-Signature headers.
 *
 * Calls: Stripe API
 * Used by:
 *   - src/modules/wallet/controllers/stripe.controller.ts
 *   - src/modules/wallet/services/top-ups.service.ts
 *   - src/modules/wallet/services/wallet.service.ts
 *   - src/modules/wallet/wallet.module.ts
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

const API = 'https://api.stripe.com/v1';
/** Stripe's default: a signed event older than 5 minutes is refused (replay protection). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** The part of a Checkout Session we read. */
export type CheckoutSession = {
  id: string;
  url?: string | null;
  payment_status?: 'paid' | 'unpaid' | 'no_payment_required';
  status?: 'open' | 'complete' | 'expired';
  amount_total?: number | null;
  currency?: string | null;
  client_reference_id?: string | null;
  payment_intent?: string | null;
};

export type StripeEvent = {
  id: string;
  type: string;
  data: { object: CheckoutSession };
};

export class WebhookSignatureError extends Error {}

/**
 * Checks a Stripe-Signature header ("t=<unix time>,v1=<hex>[,v1=<hex>]") against the raw body:
 * HMAC-SHA256 with the endpoint secret over "<t>.<raw body>", hex. Refuses old timestamps.
 * Returns the parsed event. This is the check Stripe's own libraries run.
 */
export function verifyStripeSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): StripeEvent {
  if (!header) throw new WebhookSignatureError('Missing Stripe-Signature');
  let timestamp = NaN;
  const signatures: string[] = [];
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key === 't') timestamp = Number(value);
    if (key === 'v1' && value) signatures.push(value);
  }
  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new WebhookSignatureError('Malformed Stripe-Signature');
  }
  if (Math.abs(nowSeconds - timestamp) > WEBHOOK_TOLERANCE_SECONDS) {
    throw new WebhookSignatureError('Stripe-Signature is too old');
  }
  const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest();
  const matches = signatures.some((hex) => {
    const given = Buffer.from(hex, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
  if (!matches)
    throw new WebhookSignatureError('Stripe-Signature does not match');
  return JSON.parse(body) as StripeEvent;
}

/**
 * Stripe Checkout in TEST MODE (no real money). Keys: STRIPE_SECRET_KEY (must start with
 * sk_test_) and STRIPE_WEBHOOK_SECRET (whsec_..., from the webhook endpoint in the dashboard).
 * Without both, or with a live key, top-ups are off and POST /wallet/top-ups answers 503.
 * Calls Stripe's REST API directly (form-encoded), so no SDK is needed.
 */
@Injectable()
export class StripeService {
  private readonly logger = new Logger(StripeService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    // A live key would take real money; this demo only runs on test keys.
    return Boolean(
      key?.startsWith('sk_test_') &&
      this.config.get<string>('STRIPE_WEBHOOK_SECRET'),
    );
  }

  verifyWebhook(rawBody: Buffer | string, header: string | undefined) {
    return verifyStripeSignature(
      rawBody,
      header,
      this.config.getOrThrow<string>('STRIPE_WEBHOOK_SECRET'),
    );
  }

  /** A hosted Checkout page for one top-up. The invoice ref doubles as the idempotency key. */
  async createCheckoutSession(input: {
    reference: string;
    credits: number;
    currency: string;
    amountMinor: number;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const form = new URLSearchParams({
      mode: 'payment',
      client_reference_id: input.reference,
      'metadata[reference]': input.reference,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': input.currency,
      'line_items[0][price_data][unit_amount]': String(input.amountMinor),
      'line_items[0][price_data][product_data][name]': `JobAura top up: ${input.credits} credits`,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      // Charge exactly the US dollar price we check in the webhook (no automatic local currency).
      'adaptive_pricing[enabled]': 'false',
    });
    return this.request<CheckoutSession>(
      'POST',
      '/checkout/sessions',
      form,
      input.reference,
    );
  }

  /** Used when the webhook is late. Answers null on any problem (the top-up then stays PENDING). */
  async retrieveSession(id: string): Promise<CheckoutSession | null> {
    try {
      return await this.request<CheckoutSession>(
        'GET',
        `/checkout/sessions/${encodeURIComponent(id)}`,
      );
    } catch (error) {
      this.logger.warn(
        `Stripe session lookup failed: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    form?: URLSearchParams,
    idempotencyKey?: string,
  ): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.config.getOrThrow<string>('STRIPE_SECRET_KEY')}`,
        ...(form
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: form?.toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // Stripe's error message names the problem; it holds no secret.
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`Stripe answered ${response.status}: ${detail}`);
    }
    return (await response.json()) as T;
  }
}

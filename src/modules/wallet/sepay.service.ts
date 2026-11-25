import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

export type SepayEnv = 'sandbox' | 'production';

const HOSTS: Record<SepayEnv, { checkout: string; api: string }> = {
  sandbox: {
    checkout: 'https://pay-sandbox.sepay.vn/v1/checkout/init',
    api: 'https://pgapi-sandbox.sepay.vn/v1',
  },
  production: {
    checkout: 'https://pay.sepay.vn/v1/checkout/init',
    api: 'https://pgapi.sepay.vn/v1',
  },
};

/**
 * The signed fields, in the order SePay's docs give for the signature
 * (developer.sepay.vn → Cổng thanh toán → Tạo form thanh toán). The browser form sends them
 * in the same order, then `signature`.
 */
const SIGNED_FIELDS = [
  'order_amount',
  'merchant',
  'currency',
  'operation',
  'order_description',
  'order_invoice_number',
  'customer_id',
  'payment_method',
  'success_url',
  'error_url',
  'cancel_url',
] as const;

export type CheckoutInput = {
  invoiceNumber: string;
  amountVnd: number;
  description: string;
  successUrl: string;
  errorUrl: string;
  cancelUrl: string;
};

/** What the browser posts to SePay: a plain HTML form (SePay's checkout only takes a form POST). */
export type CheckoutForm = { action: string; fields: Record<string, string> };

/**
 * SePay signature: `name=value` pairs of the signed fields that have a value, joined with ",",
 * HMAC-SHA256 with the merchant secret key, written as base64 (not hex).
 */
export function sepaySignature(
  fields: Record<string, string | undefined>,
  secretKey: string,
): string {
  const text = SIGNED_FIELDS.filter((name) => fields[name])
    .map((name) => `${name}=${fields[name]}`)
    .join(',');
  return createHmac('sha256', secretKey).update(text).digest('base64');
}

/** Same length compare without leaking timing; hashing first makes the lengths equal. */
export function sameSecret(
  given: string | undefined,
  expected: string,
): boolean {
  if (!given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/** The part of SePay's order answer we use. Other fields are ignored. */
export type SepayOrder = {
  order_status?: string;
  order_amount?: string | number;
  order_invoice_number?: string;
  transaction_id?: string;
  transactions?: Array<{
    transaction_id?: string;
    transaction_status?: string;
    payment_method?: string;
  }>;
};

/**
 * SePay payment gateway (cổng thanh toán): test money in the sandbox.
 * Keys: SEPAY_MERCHANT_ID and SEPAY_SECRET_KEY (shown once in my.sepay.vn), SEPAY_IPN_SECRET
 * (the key set on the IPN tab, sent back in the X-Secret-Key header), SEPAY_ENV (sandbox/production).
 * Without the first three, top-ups are off and POST /wallet/top-ups answers 503.
 */
@Injectable()
export class SepayService {
  private readonly logger = new Logger(SepayService.name);

  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('SEPAY_MERCHANT_ID') &&
      this.config.get<string>('SEPAY_SECRET_KEY') &&
      this.config.get<string>('SEPAY_IPN_SECRET'),
    );
  }

  env(): SepayEnv {
    return this.config.get<string>('SEPAY_ENV') === 'production'
      ? 'production'
      : 'sandbox';
  }

  checkoutForm(input: CheckoutInput): CheckoutForm {
    const fields: Record<string, string> = {
      order_amount: String(input.amountVnd),
      merchant: this.config.getOrThrow<string>('SEPAY_MERCHANT_ID'),
      currency: 'VND',
      operation: 'PURCHASE',
      order_description: input.description,
      order_invoice_number: input.invoiceNumber,
      success_url: input.successUrl,
      error_url: input.errorUrl,
      cancel_url: input.cancelUrl,
    };
    const signature = sepaySignature(
      fields,
      this.config.getOrThrow<string>('SEPAY_SECRET_KEY'),
    );
    return {
      action: HOSTS[this.env()].checkout,
      fields: { ...fields, lang: 'vi', signature },
    };
  }

  /** True when the IPN carries our IPN key in X-Secret-Key. */
  ipnSecretMatches(header: string | undefined): boolean {
    const expected = this.config.get<string>('SEPAY_IPN_SECRET');
    return Boolean(expected) && sameSecret(header, expected!);
  }

  /**
   * Ask SePay about an order (used when the IPN is late or lost). Answers null on any problem:
   * the top-up then simply stays PENDING and the IPN can still finish it.
   * The answer shape is read defensively, because SePay's docs do not list every field.
   */
  async fetchOrder(invoiceNumber: string): Promise<SepayOrder | null> {
    const merchant = this.config.get<string>('SEPAY_MERCHANT_ID');
    const secret = this.config.get<string>('SEPAY_SECRET_KEY');
    if (!merchant || !secret) return null;
    try {
      const response = await fetch(
        `${HOSTS[this.env()].api}/order/detail/${encodeURIComponent(invoiceNumber)}`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${merchant}:${secret}`).toString('base64')}`,
            'Content-Type': 'application/json',
          },
          signal: AbortSignal.timeout(8_000),
        },
      );
      if (!response.ok) {
        this.logger.warn(
          `SePay order lookup for ${invoiceNumber} answered ${response.status}`,
        );
        return null;
      }
      const body = (await response.json()) as
        | { data?: SepayOrder }
        | SepayOrder;
      const order =
        'data' in body && body.data ? body.data : (body as SepayOrder);
      return typeof order === 'object' && order ? order : null;
    } catch (error) {
      this.logger.warn(
        `SePay order lookup for ${invoiceNumber} failed: ${(error as Error).message}`,
      );
      return null;
    }
  }
}

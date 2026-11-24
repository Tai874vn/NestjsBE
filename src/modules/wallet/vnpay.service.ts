import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/** VNPay's sandbox (test) payment page; VNPAY_PAY_URL can point somewhere else. */
export const VNPAY_SANDBOX_PAY_URL =
  'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html';
/** How long the payment page stays open. */
const PAY_WINDOW_MS = 15 * 60 * 1000;
/** VNPay wants every date in Vietnam time (GMT+7). */
const GMT7_OFFSET_MS = 7 * 60 * 60 * 1000;

/**
 * Turns params into VNPay's signed text: keys sorted A-Z, keys and values URL-encoded with
 * encodeURIComponent and a space written as "+", joined as k=v&k=v. This is the same text as
 * VNPay's official Node.js demo (sortObject + qs.stringify with encode: false).
 */
export function vnpaySignData(params: Record<string, string>): string {
  const encode = (v: string) => encodeURIComponent(v).replace(/%20/g, '+');
  return Object.keys(params)
    .map((k) => [encode(k), encode(params[k])] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

/** A date as yyyyMMddHHmmss in GMT+7, whatever the server's own time zone is. */
export function vnpayDate(d: Date): string {
  const t = new Date(d.getTime() + GMT7_OFFSET_MS);
  const two = (n: number) => String(n).padStart(2, '0');
  return (
    `${t.getUTCFullYear()}${two(t.getUTCMonth() + 1)}${two(t.getUTCDate())}` +
    `${two(t.getUTCHours())}${two(t.getUTCMinutes())}${two(t.getUTCSeconds())}`
  );
}

/**
 * The buyer's IP address for vnp_IpAddr. main.ts trusts one proxy (nginx), so req.ip is the
 * browser's address. An IPv4 address seen through IPv6 ("::ffff:1.2.3.4") is written as plain
 * IPv4, and the local IPv6 address "::1" as 127.0.0.1.
 */
export function vnpayIpAddr(req: { ip?: string }): string {
  const ip = req.ip ?? '';
  if (!ip || ip === '::1') return '127.0.0.1';
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

/**
 * VNPay 2.1.0 (sandbox) signing. The pay URL carries vnp_SecureHash, an HMAC-SHA512 (a keyed
 * fingerprint only someone with the hash secret can make) of the sorted params. VNPay signs the
 * return URL and IPN (its server-to-server callback) the same way, and verify() checks it.
 * The hash secret is never logged or sent anywhere.
 */
@Injectable()
export class VnpayService {
  constructor(private readonly config: ConfigService) {}

  /** True when all of VNPAY_TMN_CODE, VNPAY_HASH_SECRET and VNPAY_RETURN_URL are set. */
  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('VNPAY_TMN_CODE') &&
      this.config.get<string>('VNPAY_HASH_SECRET') &&
      this.config.get<string>('VNPAY_RETURN_URL'),
    );
  }

  buildPayUrl(a: {
    txnRef: string;
    amountVnd: number;
    orderInfo: string;
    ipAddr: string;
    now: Date;
  }): string {
    const params: Record<string, string> = {
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: this.config.get<string>('VNPAY_TMN_CODE') ?? '',
      // VNPay counts in 1/100 VND (no decimals): 50,000 VND is sent as 5000000.
      vnp_Amount: String(a.amountVnd * 100),
      vnp_CurrCode: 'VND',
      vnp_TxnRef: a.txnRef,
      vnp_OrderInfo: a.orderInfo,
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: this.config.get<string>('VNPAY_RETURN_URL') ?? '',
      vnp_IpAddr: a.ipAddr,
      vnp_CreateDate: vnpayDate(a.now),
      vnp_ExpireDate: vnpayDate(new Date(a.now.getTime() + PAY_WINDOW_MS)),
    };
    const data = vnpaySignData(params);
    const payUrl =
      this.config.get<string>('VNPAY_PAY_URL') || VNPAY_SANDBOX_PAY_URL;
    return `${payUrl}?${data}&vnp_SecureHash=${this.sign(data)}`;
  }

  /**
   * Checks vnp_SecureHash of a return or IPN query (already URL-decoded by Express).
   * Only vnp_* params are signed; vnp_SecureHash and vnp_SecureHashType are left out.
   */
  verify(query: Record<string, string>): boolean {
    const secret = this.config.get<string>('VNPAY_HASH_SECRET');
    const given = query.vnp_SecureHash;
    if (!secret || typeof given !== 'string') return false;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(query)) {
      if (!k.startsWith('vnp_')) continue;
      if (k === 'vnp_SecureHash' || k === 'vnp_SecureHashType') continue;
      // A repeated param arrives as an array: not something VNPay sends, so refuse it.
      if (typeof v !== 'string') return false;
      params[k] = v;
    }
    const expected = Buffer.from(this.sign(vnpaySignData(params)), 'utf8');
    const actual = Buffer.from(given.toLowerCase(), 'utf8');
    // timingSafeEqual takes the same time for every input, so the hash cannot be guessed by timing.
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private sign(data: string): string {
    return createHmac('sha512', this.config.get<string>('VNPAY_HASH_SECRET')!)
      .update(Buffer.from(data, 'utf-8'))
      .digest('hex');
  }
}

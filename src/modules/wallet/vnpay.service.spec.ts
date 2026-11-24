import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import {
  VNPAY_SANDBOX_PAY_URL,
  VnpayService,
  vnpayDate,
  vnpayIpAddr,
} from './vnpay.service';

const SECRET = 'TESTSECRET0123456789ABCDEFGHIJKL';
const ENV = {
  VNPAY_TMN_CODE: 'JOBAURA1',
  VNPAY_HASH_SECRET: SECRET,
  VNPAY_RETURN_URL: 'https://jobaura.site/wallet/top-up/return',
};

function makeService(env: Record<string, string | undefined> = ENV) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new VnpayService(config);
}

const INPUT = {
  txnRef: 'JA42-a1b2c3',
  amountVnd: 50_000,
  orderInfo: 'JobAura top up 50 credits',
  ipAddr: '127.0.0.1',
  // 03:00 UTC = 10:00 in Vietnam (GMT+7).
  now: new Date('2026-11-24T03:00:00Z'),
};

/**
 * Worked out once, outside this code, with VNPay's official Node.js demo algorithm (sortObject,
 * then the qs package's stringify with encode: false, then HMAC-SHA512 hex) and checked again with
 * Python's hmac module. The text that is signed is:
 * vnp_Amount=5000000&vnp_Command=pay&vnp_CreateDate=20261124100000&vnp_CurrCode=VND&
 * vnp_ExpireDate=20261124101500&vnp_IpAddr=127.0.0.1&vnp_Locale=vn&
 * vnp_OrderInfo=JobAura+top+up+50+credits&vnp_OrderType=other&
 * vnp_ReturnUrl=https%3A%2F%2Fjobaura.site%2Fwallet%2Ftop-up%2Freturn&vnp_TmnCode=JOBAURA1&
 * vnp_TxnRef=JA42-a1b2c3&vnp_Version=2.1.0
 */
const KNOWN_GOOD_HASH =
  '231e6bc42e2b9a169064c6178bfde080e32aa63a6b90657b1d67604d3bc885944754dda1acaabd7cc22f31018dcde6b2a573ee5541093da632481ebf9f376a3e';

/** The query as Express hands it to a controller (URL-decoded, "+" read as a space). */
function queryOf(url: string): Record<string, string> {
  return Object.fromEntries(new URL(url).searchParams.entries());
}

/** Signs a query the way VNPay signs its return / IPN calls. */
function signLikeVnpay(
  params: Record<string, string>,
  secret = SECRET,
): Record<string, string> {
  const enc = (v: string) => encodeURIComponent(v).replace(/%20/g, '+');
  const data = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`)
    .join('&');
  const hash = createHmac('sha512', secret).update(data).digest('hex');
  return { ...params, vnp_SecureHashType: 'HmacSHA512', vnp_SecureHash: hash };
}

describe('VnpayService', () => {
  it('builds the pay URL with the known-good signature for fixed inputs', () => {
    const url = makeService().buildPayUrl(INPUT);
    expect(url.startsWith(`${VNPAY_SANDBOX_PAY_URL}?`)).toBe(true);
    const q = queryOf(url);
    expect(q).toMatchObject({
      vnp_Version: '2.1.0',
      vnp_Command: 'pay',
      vnp_TmnCode: 'JOBAURA1',
      vnp_Amount: '5000000',
      vnp_CurrCode: 'VND',
      vnp_TxnRef: 'JA42-a1b2c3',
      vnp_OrderInfo: 'JobAura top up 50 credits',
      vnp_OrderType: 'other',
      vnp_Locale: 'vn',
      vnp_ReturnUrl: 'https://jobaura.site/wallet/top-up/return',
      vnp_IpAddr: '127.0.0.1',
      vnp_CreateDate: '20261124100000',
      vnp_ExpireDate: '20261124101500',
    });
    expect(q.vnp_SecureHash).toBe(KNOWN_GOOD_HASH);
  });

  it('uses VNPAY_PAY_URL when it is set', () => {
    const url = makeService({
      ...ENV,
      VNPAY_PAY_URL: 'https://pay.example.test/vpcpay.html',
    }).buildPayUrl(INPUT);
    expect(url.startsWith('https://pay.example.test/vpcpay.html?')).toBe(true);
  });

  it('accepts its own signed query and rejects a changed amount', () => {
    const service = makeService();
    const q = queryOf(service.buildPayUrl(INPUT));
    expect(service.verify(q)).toBe(true);
    expect(service.verify({ ...q, vnp_Amount: '5000100' })).toBe(false);
  });

  it('accepts a VNPay-style return query and ignores vnp_SecureHashType and non-vnp params', () => {
    const service = makeService();
    const q = signLikeVnpay({
      vnp_Amount: '5000000',
      vnp_BankCode: 'NCB',
      vnp_OrderInfo: 'JobAura top up 50 credits',
      vnp_ResponseCode: '00',
      vnp_TransactionStatus: '00',
      vnp_TxnRef: 'JA42-a1b2c3',
    });
    expect(service.verify(q)).toBe(true);
    expect(service.verify({ ...q, other: 'x' })).toBe(true);
    expect(service.verify({ ...q, vnp_SecureHash: q.vnp_SecureHash.toUpperCase() })).toBe(true);
  });

  it('rejects a hash made with another secret, a missing hash and a missing secret', () => {
    const params = { vnp_Amount: '5000000', vnp_TxnRef: 'JA42-a1b2c3' };
    expect(makeService().verify(signLikeVnpay(params, 'other-secret'))).toBe(false);
    expect(makeService().verify(params)).toBe(false);
    const signed = signLikeVnpay(params);
    expect(
      makeService({ ...ENV, VNPAY_HASH_SECRET: undefined }).verify(signed),
    ).toBe(false);
  });

  it('is configured only with TMN code, hash secret and return URL all set', () => {
    expect(makeService().isConfigured()).toBe(true);
    for (const key of Object.keys(ENV)) {
      expect(makeService({ ...ENV, [key]: '' }).isConfigured()).toBe(false);
      expect(makeService({ ...ENV, [key]: undefined }).isConfigured()).toBe(false);
    }
  });

  it('writes dates as yyyyMMddHHmmss in GMT+7, also across midnight', () => {
    expect(vnpayDate(new Date('2026-12-31T17:30:05Z'))).toBe('20270101003005');
  });

  it('writes the buyer IP as plain IPv4 where it can', () => {
    expect(vnpayIpAddr({ ip: '::ffff:203.0.113.5' })).toBe('203.0.113.5');
    expect(vnpayIpAddr({ ip: '::1' })).toBe('127.0.0.1');
    expect(vnpayIpAddr({})).toBe('127.0.0.1');
    expect(vnpayIpAddr({ ip: '2001:db8::1' })).toBe('2001:db8::1');
  });
});

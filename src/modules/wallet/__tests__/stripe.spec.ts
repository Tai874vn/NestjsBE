import { TopUpStatus } from '@prisma/client';
import { createHmac } from 'crypto';
import { StripeController } from '../controllers/stripe.controller';
import {
  StripeService,
  WebhookSignatureError,
  verifyStripeSignature,
} from '../services/stripe.service';
import { LOOKUP_AFTER_MS, TopUpsService } from '../services/top-ups.service';

const config = (values: Record<string, string | undefined>) =>
  ({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!values[key]) throw new Error(`missing ${key}`);
      return values[key];
    },
  }) as any;

const KEYS = {
  STRIPE_SECRET_KEY: 'sk_test_abc',
  STRIPE_WEBHOOK_SECRET: 'whsec_test',
  FRONTEND_URL: 'https://www.jobaura.site/',
};

const sign = (body: string, t: number, secret = 'whsec_test') =>
  `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

describe('verifyStripeSignature', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'x', data: { object: {} } });
  const now = 1_800_000_000;

  it('accepts the HMAC-SHA256 hex of "<t>.<raw body>" and returns the event', () => {
    expect(verifyStripeSignature(body, sign(body, now), 'whsec_test', now).id).toBe(
      'evt_1',
    );
  });

  it('accepts when any one of several v1 signatures matches (secret rotation)', () => {
    const header = `t=${now},v1=${'0'.repeat(64)},${sign(body, now).split(',')[1]}`;
    expect(() => verifyStripeSignature(body, header, 'whsec_test', now)).not.toThrow();
  });

  it('refuses a changed body, another secret, a missing or malformed header', () => {
    const header = sign(body, now);
    const bad = [
      () => verifyStripeSignature(body.replace('evt_1', 'evt_2'), header, 'whsec_test', now),
      () => verifyStripeSignature(body, sign(body, now, 'whsec_other'), 'whsec_test', now),
      () => verifyStripeSignature(body, undefined, 'whsec_test', now),
      () => verifyStripeSignature(body, 'v1=abc', 'whsec_test', now),
    ];
    for (const run of bad) expect(run).toThrow(WebhookSignatureError);
  });

  it('refuses a signature older than 5 minutes (replay)', () => {
    expect(() =>
      verifyStripeSignature(body, sign(body, now - 301), 'whsec_test', now),
    ).toThrow('too old');
    expect(() =>
      verifyStripeSignature(body, sign(body, now - 299), 'whsec_test', now),
    ).not.toThrow();
  });
});

describe('StripeService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('is on only with a TEST secret key and a webhook secret (a live key is refused)', () => {
    expect(new StripeService(config(KEYS)).isConfigured()).toBe(true);
    expect(
      new StripeService(config({ ...KEYS, STRIPE_SECRET_KEY: 'sk_live_x' })).isConfigured(),
    ).toBe(false);
    expect(
      new StripeService(config({ ...KEYS, STRIPE_WEBHOOK_SECRET: undefined })).isConfigured(),
    ).toBe(false);
  });

  it('creates a payment-mode Checkout Session with one priced line and an idempotency key', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/cs_test_1' }), {
          status: 200,
        }),
      );
    const session = await new StripeService(config(KEYS)).createCheckoutSession({
      reference: 'JA7-abc123',
      credits: 50,
      currency: 'usd',
      amountMinor: 250,
      successUrl: 'https://x/s',
      cancelUrl: 'https://x/c',
    });
    expect(session.id).toBe('cs_test_1');
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    const headers = init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer sk_test_abc');
    expect(headers['Idempotency-Key']).toBe('JA7-abc123');
    const form = new URLSearchParams(init!.body as string);
    expect(Object.fromEntries(form)).toEqual({
      mode: 'payment',
      client_reference_id: 'JA7-abc123',
      'metadata[reference]': 'JA7-abc123',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': '250',
      'line_items[0][price_data][product_data][name]': 'JobAura top up: 50 credits',
      success_url: 'https://x/s',
      cancel_url: 'https://x/c',
      'adaptive_pricing[enabled]': 'false',
    });
  });

  it('retrieveSession answers null on an error answer', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('no', { status: 404 }));
    await expect(new StripeService(config(KEYS)).retrieveSession('cs_x')).resolves.toBeNull();
  });
});

describe('TopUpsService (Stripe)', () => {
  function setup(row?: Record<string, unknown>) {
    const state = {
      row: row
        ? {
            id: 7,
            userId: 3,
            credits: 50,
            amountVnd: 50000,
            amountMinor: 250,
            currency: 'usd',
            txnRef: 'JA7-abc123',
            status: TopUpStatus.PENDING,
            provider: 'STRIPE',
            gatewayTransactionId: 'cs_test_1',
            createdAt: new Date('2026-11-26T00:00:00Z'),
            ...row,
          }
        : null,
    };
    const topUp = {
      findUnique: jest.fn(() => Promise.resolve(state.row)),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        state.row = { ...(state.row ?? { id: 7, txnRef: 'JA7-ffffff' }), ...data } as typeof state.row;
        return Promise.resolve(state.row);
      }),
      updateMany: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        if (state.row?.status !== TopUpStatus.PENDING) return Promise.resolve({ count: 0 });
        state.row = { ...state.row, ...data } as typeof state.row;
        return Promise.resolve({ count: 1 });
      }),
      create: jest.fn(() => Promise.resolve({ id: 7 })),
    };
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve(state.row ? [{ id: 7 }] : [])),
      topUp,
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      wallet: { findUnique: jest.fn(() => Promise.resolve({ available: 5050 })) },
    };
    const wallet = { creditTopUp: jest.fn() };
    const stripe = {
      isConfigured: jest.fn(() => true),
      createCheckoutSession: jest.fn(() =>
        Promise.resolve({ id: 'cs_test_9', url: 'https://checkout.stripe.com/c/pay/cs_test_9' }),
      ),
      retrieveSession: jest.fn(),
    };
    const service = new TopUpsService(prisma as any, wallet as any, stripe as any, config(KEYS));
    return { state, topUp, wallet, stripe, service };
  }

  const event = (type: string, session: Record<string, unknown> = {}) => ({
    id: 'evt_1',
    type,
    data: {
      object: {
        id: 'cs_test_1',
        client_reference_id: 'JA7-abc123',
        payment_status: 'paid',
        amount_total: 250,
        currency: 'usd',
        ...session,
      },
    },
  });

  it('start() answers 503 while Stripe is not set up', async () => {
    const { stripe, service } = setup();
    stripe.isConfigured.mockReturnValue(false);
    await expect(service.start(3, 50)).rejects.toMatchObject({ status: 503 });
  });

  it('start() charges 5 US cents per credit, saves the session id and answers the hosted URL', async () => {
    const { topUp, stripe, service } = setup();
    const result = await service.start(3, 50);
    expect(topUp.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amountMinor: 250, currency: 'usd', amountVnd: 50000, provider: 'STRIPE' }),
    });
    expect(stripe.createCheckoutSession).toHaveBeenCalledWith({
      reference: expect.stringMatching(/^JA7-[0-9a-f]{6}$/),
      credits: 50,
      currency: 'usd',
      amountMinor: 250,
      successUrl: 'https://www.jobaura.site/wallet/top-up/return?topUp=7&result=success',
      cancelUrl: 'https://www.jobaura.site/wallet/top-up/return?topUp=7&result=cancel',
    });
    expect(topUp.update).toHaveBeenLastCalledWith({
      where: { id: 7 },
      data: { gatewayTransactionId: 'cs_test_9' },
    });
    expect(result).toEqual({ topUpId: 7, checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_9' });
  });

  it('start() marks the top-up FAILED and answers 503 when Stripe refuses', async () => {
    const { topUp, stripe, service } = setup();
    stripe.createCheckoutSession.mockRejectedValueOnce(new Error('Stripe answered 400'));
    await expect(service.start(3, 50)).rejects.toMatchObject({ status: 503 });
    expect(topUp.update).toHaveBeenLastCalledWith({
      where: { id: 7 },
      data: { status: TopUpStatus.FAILED },
    });
  });

  it('a paid checkout.session.completed credits once; the same event again changes nothing', async () => {
    const { state, wallet, service } = setup({});
    await expect(service.handleEvent(event('checkout.session.completed'))).resolves.toBe('credited');
    expect(state.row!.status).toBe(TopUpStatus.PAID);
    await expect(service.handleEvent(event('checkout.session.completed'))).resolves.toBe('already_done');
    expect(wallet.creditTopUp).toHaveBeenCalledTimes(1);
  });

  it('unpaid (delayed method), a different amount or currency, or another event credits nothing', async () => {
    const { state, wallet, service } = setup({});
    await expect(
      service.handleEvent(event('checkout.session.completed', { payment_status: 'unpaid' })),
    ).resolves.toBe('not_paid');
    await expect(
      service.handleEvent(event('checkout.session.completed', { amount_total: 249 })),
    ).resolves.toBe('amount_mismatch');
    await expect(
      service.handleEvent(event('checkout.session.completed', { currency: 'eur' })),
    ).resolves.toBe('amount_mismatch');
    await expect(service.handleEvent(event('payment_intent.created'))).resolves.toBe('ignored');
    expect(state.row!.status).toBe(TopUpStatus.PENDING);
    expect(wallet.creditTopUp).not.toHaveBeenCalled();
  });

  it('async success credits; an expired or failed session marks a PENDING top-up FAILED but never a PAID one', async () => {
    const a = setup({});
    await expect(
      a.service.handleEvent(event('checkout.session.async_payment_succeeded')),
    ).resolves.toBe('credited');
    await expect(a.service.handleEvent(event('checkout.session.expired'))).resolves.toBe('already_done');
    expect(a.state.row!.status).toBe(TopUpStatus.PAID);

    const b = setup({});
    await expect(b.service.handleEvent(event('checkout.session.expired'))).resolves.toBe('failed');
    expect(b.state.row!.status).toBe(TopUpStatus.FAILED);
  });

  it('status() hides other users’ top-ups and asks Stripe only after the webhook had time', async () => {
    const other = setup({ userId: 99 });
    await expect(other.service.status(3, 7)).rejects.toMatchObject({ status: 404 });

    const { state, stripe, wallet, service } = setup({});
    const created = state.row!.createdAt.getTime();
    await service.status(3, 7, new Date(created + LOOKUP_AFTER_MS - 1));
    expect(stripe.retrieveSession).not.toHaveBeenCalled();

    stripe.retrieveSession.mockResolvedValueOnce(event('x').data.object);
    const view = await service.status(3, 7, new Date(created + LOOKUP_AFTER_MS));
    expect(stripe.retrieveSession).toHaveBeenCalledWith('cs_test_1');
    expect(view).toEqual({ topUpId: 7, status: 'PAID', credits: 50, available: 5050 });
    expect(wallet.creditTopUp).toHaveBeenCalledTimes(1);
  });
});

describe('StripeController webhook', () => {
  const body = JSON.stringify({
    id: 'evt_1',
    type: 'checkout.session.completed',
    data: { object: {} },
  });
  const make = (outcome: Promise<string>) => {
    const topUps = { handleEvent: jest.fn(() => outcome) };
    const controller = new StripeController(topUps as any, new StripeService(config(KEYS)));
    return { topUps, controller };
  };
  const req = (raw?: string) => ({ rawBody: raw === undefined ? undefined : Buffer.from(raw) }) as any;

  it('400 for a bad signature or a missing raw body; the event is not handled', async () => {
    const { topUps, controller } = make(Promise.resolve('credited'));
    await expect(controller.webhook(req(body), 't=1,v1=00')).rejects.toMatchObject({ status: 400 });
    await expect(controller.webhook(req(), 'x')).rejects.toMatchObject({ status: 400 });
    expect(topUps.handleEvent).not.toHaveBeenCalled();
  });

  it('200 { received: true } for a signed event, also for duplicates and wrong amounts', async () => {
    for (const outcome of ['credited', 'already_done', 'amount_mismatch', 'ignored']) {
      const { controller } = make(Promise.resolve(outcome));
      const t = Math.floor(Date.now() / 1000);
      await expect(controller.webhook(req(body), sign(body, t))).resolves.toEqual({ received: true });
    }
  });

  it('our own error is thrown (500), so Stripe retries later', async () => {
    const { controller } = make(Promise.reject(new Error('db down')));
    const t = Math.floor(Date.now() / 1000);
    await expect(controller.webhook(req(body), sign(body, t))).rejects.toThrow('db down');
  });
});

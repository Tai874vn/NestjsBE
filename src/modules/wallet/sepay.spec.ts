import { TopUpStatus } from '@prisma/client';
import { SepayController } from './controllers/sepay.controller';
import { SepayService, sameSecret, sepaySignature } from './sepay.service';
import { LOOKUP_AFTER_MS, TopUpsService } from './top-ups.service';

const config = (values: Record<string, string | undefined>) =>
  ({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!values[key]) throw new Error(`missing ${key}`);
      return values[key];
    },
  }) as any;

const KEYS = {
  SEPAY_MERCHANT_ID: 'MID123',
  SEPAY_SECRET_KEY: 'spsk_test_secret',
  SEPAY_IPN_SECRET: 'ipn-key',
  FRONTEND_URL: 'https://www.jobaura.site/',
};

describe('SePay signature', () => {
  // Expected value computed separately with Python's hmac + base64 on the same text.
  it('matches an independently computed HMAC-SHA256 base64 over name=value pairs joined by ","', () => {
    const back = (r: string) =>
      `https://www.jobaura.site/wallet/top-up/return?topUp=7&result=${r}`;
    const signature = sepaySignature(
      {
        // Given out of order on purpose: the signature uses SePay's field order.
        cancel_url: back('cancel'),
        merchant: 'MID123',
        order_amount: '50000',
        currency: 'VND',
        operation: 'PURCHASE',
        order_description: 'JobAura top up 50 credits',
        order_invoice_number: 'JA7-abc123',
        success_url: back('success'),
        error_url: back('error'),
        lang: 'vi',
        customer_id: '',
      },
      'spsk_test_secret',
    );
    expect(signature).toBe('qaniBywm/Wn0lsEsprF1rwYf/b7fm8Xcw6h+4vT25oM=');
  });

  it('sameSecret compares without leaking length and refuses a missing value', () => {
    expect(sameSecret('ipn-key', 'ipn-key')).toBe(true);
    expect(sameSecret('ipn-ke', 'ipn-key')).toBe(false);
    expect(sameSecret(undefined, 'ipn-key')).toBe(false);
  });
});

describe('SepayService', () => {
  it('is off until merchant id, secret key and IPN key are all set', () => {
    expect(new SepayService(config({})).isConfigured()).toBe(false);
    expect(
      new SepayService(config({ ...KEYS, SEPAY_IPN_SECRET: undefined })).isConfigured(),
    ).toBe(false);
    expect(new SepayService(config(KEYS)).isConfigured()).toBe(true);
  });

  it('builds the sandbox form by default, with the signature last', () => {
    const form = new SepayService(config(KEYS)).checkoutForm({
      invoiceNumber: 'JA7-abc123',
      amountVnd: 50000,
      description: 'JobAura top up 50 credits',
      successUrl: 'https://x/s',
      errorUrl: 'https://x/e',
      cancelUrl: 'https://x/c',
    });
    expect(form.action).toBe('https://pay-sandbox.sepay.vn/v1/checkout/init');
    expect(Object.keys(form.fields)).toEqual([
      'order_amount',
      'merchant',
      'currency',
      'operation',
      'order_description',
      'order_invoice_number',
      'success_url',
      'error_url',
      'cancel_url',
      'lang',
      'signature',
    ]);
    expect(form.fields.signature).toBe(
      sepaySignature(form.fields, 'spsk_test_secret'),
    );
  });

  it('uses the production host only when SEPAY_ENV=production', () => {
    const form = new SepayService(
      config({ ...KEYS, SEPAY_ENV: 'production' }),
    ).checkoutForm({
      invoiceNumber: 'i',
      amountVnd: 10000,
      description: 'd',
      successUrl: 's',
      errorUrl: 'e',
      cancelUrl: 'c',
    });
    expect(form.action).toBe('https://pay.sepay.vn/v1/checkout/init');
  });

  it('fetchOrder uses Basic auth and answers null on an error answer', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { order_status: 'CAPTURED' } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response('nope', { status: 404 }));
    const sepay = new SepayService(config(KEYS));
    await expect(sepay.fetchOrder('JA7-abc123')).resolves.toEqual({
      order_status: 'CAPTURED',
    });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(
      'https://pgapi-sandbox.sepay.vn/v1/order/detail/JA7-abc123',
    );
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from('MID123:spsk_test_secret').toString('base64')}`,
    );
    await expect(sepay.fetchOrder('JA7-abc123')).resolves.toBeNull();
    fetchSpy.mockRestore();
  });
});

describe('TopUpsService (SePay)', () => {
  function setup(row?: Record<string, unknown>) {
    const state = {
      row: row
        ? {
            id: 7,
            userId: 3,
            credits: 50,
            amountVnd: 50000,
            txnRef: 'JA7-abc123',
            status: TopUpStatus.PENDING,
            provider: 'SEPAY',
            createdAt: new Date('2026-11-26T00:00:00Z'),
            ...row,
          }
        : null,
    };
    const tx = {
      $queryRaw: jest.fn(() => Promise.resolve(state.row ? [{ id: 7 }] : [])),
      topUp: {
        findUnique: jest.fn(() => Promise.resolve(state.row)),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          state.row = { ...state.row!, ...data } as typeof state.row;
          return Promise.resolve(state.row);
        }),
        create: jest.fn(() => Promise.resolve({ id: 7 })),
      },
    };
    const prisma = {
      ...tx,
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
      wallet: { findUnique: jest.fn(() => Promise.resolve({ available: 5050 })) },
    };
    const wallet = { creditTopUp: jest.fn() };
    const sepay = {
      isConfigured: jest.fn(() => true),
      checkoutForm: jest.fn(() => ({ action: 'a', fields: {} })),
      fetchOrder: jest.fn(),
    };
    const service = new TopUpsService(
      prisma as any,
      wallet as any,
      sepay as any,
      config(KEYS),
    );
    return { state, tx, prisma, wallet, sepay, service };
  }

  const paidIpn = (amount: string | number = '50000.00') => ({
    notification_type: 'ORDER_PAID',
    order: {
      order_invoice_number: 'JA7-abc123',
      order_amount: amount,
      order_status: 'CAPTURED',
    },
    transaction: {
      transaction_id: 'T1',
      transaction_status: 'APPROVED',
      payment_method: 'BANK_TRANSFER',
    },
  });

  it('start() answers 503 while SePay is not set up', async () => {
    const { sepay, service } = setup();
    sepay.isConfigured.mockReturnValue(false);
    await expect(service.start(3, 50)).rejects.toMatchObject({ status: 503 });
  });

  it('start() saves a PENDING SePay top-up and signs return URLs for it', async () => {
    const { tx, sepay, service } = setup();
    tx.topUp.update.mockResolvedValueOnce({ id: 7, txnRef: 'JA7-ffffff' } as never);
    const result = await service.start(3, 50);
    expect(tx.topUp.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 3,
        credits: 50,
        amountVnd: 50000,
        provider: 'SEPAY',
      }),
    });
    expect(sepay.checkoutForm).toHaveBeenCalledWith({
      invoiceNumber: 'JA7-ffffff',
      amountVnd: 50000,
      description: 'JobAura top up 50 credits',
      successUrl: 'https://www.jobaura.site/wallet/top-up/return?topUp=7&result=success',
      errorUrl: 'https://www.jobaura.site/wallet/top-up/return?topUp=7&result=error',
      cancelUrl: 'https://www.jobaura.site/wallet/top-up/return?topUp=7&result=cancel',
    });
    expect(result.topUpId).toBe(7);
  });

  it('a paid IPN credits the wallet once; the same IPN again changes nothing', async () => {
    const { state, wallet, service } = setup({});
    await expect(service.handleIpn(paidIpn())).resolves.toBe('credited');
    expect(state.row!.status).toBe(TopUpStatus.PAID);
    expect(state.row!.gatewayTransactionId).toBe('T1');
    expect(wallet.creditTopUp).toHaveBeenCalledTimes(1);
    await expect(service.handleIpn(paidIpn())).resolves.toBe('already_done');
    expect(wallet.creditTopUp).toHaveBeenCalledTimes(1);
  });

  it('a different amount, an unknown order or another notification type credits nothing', async () => {
    const { state, wallet, service } = setup({});
    await expect(service.handleIpn(paidIpn('49999'))).resolves.toBe(
      'amount_mismatch',
    );
    await expect(
      service.handleIpn({ ...paidIpn(), notification_type: 'TRANSACTION_VOID' }),
    ).resolves.toBe('not_paid');
    await expect(
      service.handleIpn({ ...paidIpn(), order: { order_amount: '50000' } }),
    ).resolves.toBe('not_found');
    expect(state.row!.status).toBe(TopUpStatus.PENDING);
    expect(wallet.creditTopUp).not.toHaveBeenCalled();
  });

  it('status() hides other users’ top-ups (404)', async () => {
    const { service } = setup({ userId: 99 });
    await expect(service.status(3, 7)).rejects.toMatchObject({ status: 404 });
  });

  it('status() asks SePay only after the IPN had time, and credits a CAPTURED order', async () => {
    const { state, sepay, wallet, service } = setup({});
    const created = state.row!.createdAt.getTime();
    await service.status(3, 7, new Date(created + LOOKUP_AFTER_MS - 1));
    expect(sepay.fetchOrder).not.toHaveBeenCalled();

    sepay.fetchOrder.mockResolvedValueOnce({
      order_status: 'CAPTURED',
      order_amount: '50000.00',
      transactions: [{ transaction_id: 'T9', payment_method: 'BANK_TRANSFER' }],
    });
    const view = await service.status(3, 7, new Date(created + LOOKUP_AFTER_MS));
    expect(sepay.fetchOrder).toHaveBeenCalledWith('JA7-abc123');
    expect(view).toEqual({ topUpId: 7, status: 'PAID', credits: 50, available: 5050 });
    expect(wallet.creditTopUp).toHaveBeenCalledTimes(1);
  });

  it('status() leaves the top-up PENDING when SePay does not say it is paid', async () => {
    const { state, sepay, service } = setup({});
    sepay.fetchOrder.mockResolvedValueOnce({ order_status: 'PENDING' });
    const view = await service.status(3, 7, new Date(state.row!.createdAt.getTime() + 60_000));
    expect(view.status).toBe('PENDING');
  });
});

describe('SepayController IPN', () => {
  const make = (outcome: Promise<string>) => {
    const topUps = { handleIpn: jest.fn(() => outcome) };
    const sepay = new SepayService(config(KEYS));
    return { topUps, controller: new SepayController(topUps as any, sepay) };
  };

  it('401 for a missing or wrong X-Secret-Key, and the body is not read', async () => {
    const { topUps, controller } = make(Promise.resolve('credited'));
    await expect(controller.ipn(undefined, {})).rejects.toMatchObject({ status: 401 });
    await expect(controller.ipn('wrong', {})).rejects.toMatchObject({ status: 401 });
    expect(topUps.handleIpn).not.toHaveBeenCalled();
  });

  it('200 { success: true } once handled, also for duplicates and wrong amounts', async () => {
    for (const outcome of ['credited', 'already_done', 'amount_mismatch']) {
      const { controller } = make(Promise.resolve(outcome));
      await expect(controller.ipn('ipn-key', {})).resolves.toEqual({ success: true });
    }
  });

  it('our own error is thrown (500), so SePay sends the IPN again later', async () => {
    const { controller } = make(Promise.reject(new Error('db down')));
    await expect(controller.ipn('ipn-key', {})).rejects.toThrow('db down');
  });
});

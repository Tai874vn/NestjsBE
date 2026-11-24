import {
  ArgumentMetadata,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TopUpStatus } from '@prisma/client';
import { createHmac } from 'crypto';
import { TopUpDto } from './dto/top-up.dto';
import { TopUpsService } from './top-ups.service';
import { VnpayService, vnpaySignData } from './vnpay.service';

const SECRET = 'TESTSECRET0123456789ABCDEFGHIJKL';
const ENV: Record<string, string | undefined> = {
  VNPAY_TMN_CODE: 'JOBAURA1',
  VNPAY_HASH_SECRET: SECRET,
  VNPAY_RETURN_URL: 'https://jobaura.site/wallet/top-up/return',
};

type Row = {
  id: number;
  userId: number;
  credits: number;
  amountVnd: number;
  txnRef: string;
  status: TopUpStatus;
  vnpTransactionNo: string | null;
  bankCode: string | null;
  responseCode: string | null;
  paidAt: Date | null;
  createdAt: Date;
};

/**
 * A fake database with a top_ups table and one wallet balance per user. The wallet service is a
 * spy: creditTopUp adds the credits so the test can see how often it ran.
 */
function setup(env: Record<string, string | undefined> = ENV) {
  const rows = new Map<number, Row>();
  const available = new Map<number, number>();
  let nextId = 42;
  const tx = {
    $queryRaw: jest.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      if (sql.includes('"top_ups"') && sql.includes('FOR UPDATE')) {
        const found = [...rows.values()].find((r) => r.txnRef === values[0]);
        return Promise.resolve(found ? [{ id: found.id }] : []);
      }
      return Promise.resolve([]);
    }),
    topUp: {
      create: jest.fn(({ data }: { data: Partial<Row> }) => {
        const row: Row = {
          id: nextId++,
          status: TopUpStatus.PENDING,
          vnpTransactionNo: null,
          bankCode: null,
          responseCode: null,
          paidAt: null,
          createdAt: new Date(),
          ...(data as Row),
        };
        rows.set(row.id, row);
        return Promise.resolve({ ...row });
      }),
      update: jest.fn(
        ({ where, data }: { where: { id: number }; data: Partial<Row> }) => {
          const row = rows.get(where.id)!;
          Object.assign(row, data);
          return Promise.resolve({ ...row });
        },
      ),
      findUnique: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(rows.has(where.id) ? { ...rows.get(where.id)! } : null),
      ),
    },
    wallet: {
      findUnique: jest.fn(({ where }: { where: { userId: number } }) =>
        Promise.resolve({
          userId: where.userId,
          available: available.get(where.userId) ?? 5000,
          held: 0,
        }),
      ),
    },
  };
  const prisma = {
    ...tx,
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const wallet = {
    creditTopUp: jest.fn(
      (_tx: unknown, a: { userId: number; credits: number; topUpId: number }) => {
        available.set(a.userId, (available.get(a.userId) ?? 5000) + a.credits);
        return Promise.resolve();
      },
    ),
    ensure: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const vnpay = new VnpayService(config);
  const service = new TopUpsService(
    prisma as never,
    wallet as never,
    vnpay,
  );
  return { service, prisma, tx, wallet, rows, available };
}

/** Signs a query the way VNPay signs its return / IPN calls. */
function signed(params: Record<string, string>, secret = SECRET) {
  const hash = createHmac('sha512', secret)
    .update(vnpaySignData(params))
    .digest('hex');
  return { ...params, vnp_SecureHashType: 'HmacSHA512', vnp_SecureHash: hash };
}

function vnpayAnswer(row: Row, over: Record<string, string> = {}) {
  return signed({
    vnp_TmnCode: 'JOBAURA1',
    vnp_Amount: String(row.amountVnd * 100),
    vnp_BankCode: 'NCB',
    vnp_OrderInfo: `JobAura top up ${row.credits} credits`,
    vnp_PayDate: '20261124101000',
    vnp_ResponseCode: '00',
    vnp_TransactionNo: '14012345',
    vnp_TransactionStatus: '00',
    vnp_TxnRef: row.txnRef,
    ...over,
  });
}

async function started(ctx: ReturnType<typeof setup>, userId = 7, credits = 50) {
  const { topUpId } = await ctx.service.start(userId, credits, '127.0.0.1');
  return ctx.rows.get(topUpId)!;
}

describe('TopUpsService.start', () => {
  it('saves a PENDING top-up and answers a signed VNPay pay URL', async () => {
    const ctx = setup();
    const { topUpId, payUrl } = await ctx.service.start(7, 50, '127.0.0.1');
    const row = ctx.rows.get(topUpId)!;
    expect(row).toMatchObject({
      userId: 7,
      credits: 50,
      amountVnd: 50_000,
      status: TopUpStatus.PENDING,
    });
    expect(row.txnRef).toMatch(/^JA42-[0-9a-f]{6}$/);
    const q = Object.fromEntries(new URL(payUrl).searchParams.entries());
    expect(q).toMatchObject({
      vnp_TxnRef: row.txnRef,
      vnp_Amount: '5000000',
      vnp_OrderInfo: 'JobAura top up 50 credits',
      vnp_IpAddr: '127.0.0.1',
    });
    expect(new VnpayService({ get: (k: string) => ENV[k] } as never).verify(q)).toBe(true);
  });

  it('answers 503 "Top up is not set up." when the VNPay keys are missing', async () => {
    const ctx = setup({ ...ENV, VNPAY_HASH_SECRET: undefined });
    await expect(ctx.service.start(7, 50, '127.0.0.1')).rejects.toThrow(
      new ServiceUnavailableException('Top up is not set up.'),
    );
    expect(ctx.tx.topUp.create).not.toHaveBeenCalled();
  });
});

describe('TopUpsService.complete', () => {
  it('IPN twice with the same success query: credits added once, second answer 02', async () => {
    const ctx = setup();
    const row = await started(ctx);
    const query = vnpayAnswer(row);

    const first = await ctx.service.complete(query);
    expect(first.code).toBe('00');
    expect(first.topUp).toMatchObject({
      status: TopUpStatus.PAID,
      vnpTransactionNo: '14012345',
      bankCode: 'NCB',
      responseCode: '00',
    });
    expect(first.topUp!.paidAt).toBeInstanceOf(Date);

    const second = await ctx.service.complete(query);
    expect(second.code).toBe('02');
    expect(ctx.wallet.creditTopUp).toHaveBeenCalledTimes(1);
    expect(ctx.wallet.creditTopUp).toHaveBeenCalledWith(ctx.tx, {
      userId: 7,
      credits: 50,
      topUpId: row.id,
    });
    expect(ctx.available.get(7)).toBe(5050);
    // The row is locked before it is read (SELECT ... FOR UPDATE).
    expect(ctx.tx.$queryRaw).toHaveBeenCalled();
  });

  it('bad hash → 97 and nothing is read or written', async () => {
    const ctx = setup();
    const row = await started(ctx);
    ctx.prisma.$transaction.mockClear();
    const query = { ...vnpayAnswer(row), vnp_Amount: '9900000' };
    expect((await ctx.service.complete(query)).code).toBe('97');
    expect(
      (await ctx.service.complete(signed({ vnp_TxnRef: row.txnRef }, 'wrong'))).code,
    ).toBe('97');
    expect(ctx.prisma.$transaction).not.toHaveBeenCalled();
    expect(ctx.wallet.creditTopUp).not.toHaveBeenCalled();
    expect(ctx.rows.get(row.id)!.status).toBe(TopUpStatus.PENDING);
  });

  it('unknown vnp_TxnRef → 01', async () => {
    const ctx = setup();
    const row = await started(ctx);
    const res = await ctx.service.complete(
      vnpayAnswer({ ...row, txnRef: 'JA999-ffffff' }),
    );
    expect(res).toEqual({ code: '01' });
  });

  it('amount mismatch (validly signed) → 04, nothing written', async () => {
    const ctx = setup();
    const row = await started(ctx);
    const res = await ctx.service.complete(
      vnpayAnswer(row, { vnp_Amount: '4900000' }),
    );
    expect(res.code).toBe('04');
    expect(ctx.tx.topUp.update).toHaveBeenCalledTimes(1); // only start() set the txnRef
    expect(ctx.wallet.creditTopUp).not.toHaveBeenCalled();
    expect(ctx.rows.get(row.id)!.status).toBe(TopUpStatus.PENDING);
  });

  it('failed response code → FAILED, answer 00, no ledger row; later success query → 02', async () => {
    const ctx = setup();
    const row = await started(ctx);
    const res = await ctx.service.complete(
      vnpayAnswer(row, { vnp_ResponseCode: '24', vnp_TransactionStatus: '02' }),
    );
    expect(res.code).toBe('00');
    expect(res.topUp).toMatchObject({
      status: TopUpStatus.FAILED,
      responseCode: '24',
      paidAt: null,
    });
    expect(ctx.wallet.creditTopUp).not.toHaveBeenCalled();
    expect((await ctx.service.complete(vnpayAnswer(row))).code).toBe('02');
    expect(ctx.wallet.creditTopUp).not.toHaveBeenCalled();
  });

  it('response code 00 but transaction status not 00 → FAILED', async () => {
    const ctx = setup();
    const row = await started(ctx);
    const res = await ctx.service.complete(
      vnpayAnswer(row, { vnp_TransactionStatus: '01' }),
    );
    expect(res.topUp!.status).toBe(TopUpStatus.FAILED);
    expect(ctx.wallet.creditTopUp).not.toHaveBeenCalled();
  });
});

describe('TopUpsService.finishReturn (GET /wallet/top-ups/vnpay-return)', () => {
  it('success → PAID with the new balance; a refresh answers PAID again without crediting twice', async () => {
    const ctx = setup();
    const row = await started(ctx);
    const query = vnpayAnswer(row);
    await expect(ctx.service.finishReturn(7, query)).resolves.toEqual({
      status: TopUpStatus.PAID,
      credits: 50,
      available: 5050,
    });
    await expect(ctx.service.finishReturn(7, query)).resolves.toEqual({
      status: TopUpStatus.PAID,
      credits: 50,
      available: 5050,
    });
    expect(ctx.wallet.creditTopUp).toHaveBeenCalledTimes(1);
  });

  it('failed response code → FAILED, no ledger row', async () => {
    const ctx = setup();
    const row = await started(ctx);
    await expect(
      ctx.service.finishReturn(7, vnpayAnswer(row, { vnp_ResponseCode: '24' })),
    ).resolves.toEqual({ status: TopUpStatus.FAILED, credits: 50, available: 5000 });
    expect(ctx.wallet.creditTopUp).not.toHaveBeenCalled();
  });

  it('another user’s top-up → 404', async () => {
    const ctx = setup();
    const row = await started(ctx, 7);
    await expect(
      ctx.service.finishReturn(8, vnpayAnswer(row)),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('bad hash → 400, unknown ref → 404, wrong amount → 400', async () => {
    const ctx = setup();
    const row = await started(ctx);
    await expect(
      ctx.service.finishReturn(7, { ...vnpayAnswer(row), vnp_ResponseCode: '24' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      ctx.service.finishReturn(7, vnpayAnswer({ ...row, txnRef: 'JA1-000000' })),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      ctx.service.finishReturn(7, vnpayAnswer(row, { vnp_Amount: '1' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ctx.wallet.creditTopUp).not.toHaveBeenCalled();
  });
});

describe('TopUpDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const meta: ArgumentMetadata = { type: 'body', metatype: TopUpDto };

  it('credits: 9 → 400 naming the field', async () => {
    await expect(pipe.transform({ credits: 9 }, meta)).rejects.toMatchObject({
      response: { message: ['credits must be at least 10.'] },
    });
  });

  it('refuses 10001 and 10.5, accepts 10 and 10000', async () => {
    await expect(pipe.transform({ credits: 10001 }, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform({ credits: 10.5 }, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(pipe.transform({ credits: 10 }, meta)).resolves.toEqual({ credits: 10 });
    await expect(pipe.transform({ credits: 10000 }, meta)).resolves.toEqual({
      credits: 10000,
    });
  });
});

import { ConflictException } from '@nestjs/common';
import { LedgerType, Prisma } from '@prisma/client';
import {
  InsufficientCreditsError,
  STARTING_GRANT,
  WalletService,
} from './wallet.service';

type Balance = { available: number; held: number };

/**
 * A fake Prisma (database client). `wallets` holds the balances the fake database knows.
 * $queryRaw answers the two raw queries of the service: the INSERT ... ON CONFLICT of ensure()
 * (it returns a row only when the wallet did not exist yet) and the SELECT ... FOR UPDATE of lock().
 */
function createService(
  start: Record<number, Balance> = {},
  topUpConfigured = false,
) {
  const wallets = new Map<number, Balance>(
    Object.entries(start).map(([id, b]) => [Number(id), { ...b }]),
  );
  const sqlOf = (strings: TemplateStringsArray) => strings.join('?');
  const prisma = {
    $queryRaw: jest.fn(
      (strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = sqlOf(strings);
        if (sql.includes('INSERT INTO "wallets"')) {
          const userId = values[0] as number;
          if (wallets.has(userId)) return Promise.resolve([]);
          wallets.set(userId, { available: STARTING_GRANT, held: 0 });
          return Promise.resolve([{ userId }]);
        }
        if (sql.includes('FOR UPDATE')) {
          const ids = values[0] as number[];
          return Promise.resolve(
            ids
              .filter((id) => wallets.has(id))
              .map((id) => ({ userId: id, ...wallets.get(id)! })),
          );
        }
        return Promise.resolve([]);
      },
    ),
    $transaction: jest.fn(),
    wallet: {
      findUnique: jest.fn(({ where }: { where: { userId: number } }) =>
        Promise.resolve(
          wallets.has(where.userId)
            ? { userId: where.userId, ...wallets.get(where.userId)! }
            : null,
        ),
      ),
      // Applies { increment } / { decrement } like the real client and returns the new row.
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { userId: number };
          data: Record<string, { increment?: number; decrement?: number }>;
        }) => {
          const w = wallets.get(where.userId)!;
          for (const key of ['available', 'held'] as const) {
            const change = data[key];
            if (!change) continue;
            w[key] += (change.increment ?? 0) - (change.decrement ?? 0);
          }
          return Promise.resolve({ userId: where.userId, ...w });
        },
      ),
    },
    ledgerEntry: {
      create: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn(),
    },
  };
  // The transaction mock runs the callback with this same mock as `tx`.
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  const stripe = { isConfigured: () => topUpConfigured };
  const service = new WalletService(prisma as never, stripe as never);
  const tx = prisma as unknown as Prisma.TransactionClient;
  const ledgerRows = () =>
    prisma.ledgerEntry.create.mock.calls.map(
      ([arg]: [{ data: Record<string, unknown> }]) => arg.data,
    );
  return { service, prisma, tx, wallets, ledgerRows };
}

const move = {
  clientId: 3,
  freelancerId: 9,
  amount: 2000,
  contractId: 40,
  milestoneId: 41,
};

describe('WalletService', () => {
  describe('ensure', () => {
    it('writes one SEED row of 5,000 for a new user, and nothing on the second call', async () => {
      const { service, tx, ledgerRows } = createService();

      await service.ensure(tx, 7);
      await service.ensure(tx, 7);

      expect(STARTING_GRANT).toBe(5000);
      expect(ledgerRows()).toEqual([
        {
          userId: 7,
          type: LedgerType.SEED,
          availableDelta: 5000,
          heldDelta: 0,
          availableAfter: 5000,
          heldAfter: 0,
        },
      ]);
    });

    it('uses INSERT ... ON CONFLICT DO NOTHING RETURNING (safe when two requests race)', async () => {
      const { service, tx, prisma } = createService();

      await service.ensure(tx, 7);

      const [strings] = prisma.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
      ];
      const sql = strings.join('?');
      expect(sql).toContain('ON CONFLICT ("userId") DO NOTHING');
      expect(sql).toContain('RETURNING "userId"');
    });

    it('writes no SEED row when the insert lost the race (conflict path)', async () => {
      // The other request created the wallet first: the INSERT returns no row.
      const { service, tx, ledgerRows } = createService({
        7: { available: 5000, held: 0 },
      });

      await service.ensure(tx, 7);

      expect(ledgerRows()).toEqual([]);
    });
  });

  describe('lock', () => {
    it('locks the wallets in ascending user id order, each once', async () => {
      const { service, tx, prisma } = createService();

      const locked = await service.lock(tx, [9, 3, 9]);

      const lockCall = prisma.$queryRaw.mock.calls.find(([strings]) =>
        (strings).join('?').includes('FOR UPDATE'),
      ) as [TemplateStringsArray, ...unknown[]];
      expect(lockCall[1]).toEqual([3, 9]);
      expect(lockCall[0].join('?')).toContain('ORDER BY "userId"');
      // ensure() ran first for each user, also in ascending order.
      const inserts = prisma.$queryRaw.mock.calls
        .filter(([strings]) =>
          (strings).join('?').includes('INSERT'),
        )
        .map(([, id]) => id as number);
      expect(inserts).toEqual([3, 9]);
      expect(locked.get(3)).toEqual({ available: 5000, held: 0 });
      expect(locked.get(9)).toEqual({ available: 5000, held: 0 });
    });
  });

  describe('hold', () => {
    it('throws InsufficientCreditsError(1250, 2000) when the client has too few credits', async () => {
      const { service, tx, prisma } = createService({
        3: { available: 1250, held: 0 },
        9: { available: 0, held: 0 },
      });

      const err = await service.hold(tx, move).catch((e: unknown) => e);

      expect(err).toBeInstanceOf(InsufficientCreditsError);
      expect(err).toMatchObject({ available: 1250, needed: 2000 });
      expect((err as Error).message).toBe(
        'You have 1,250 credits; this milestone needs 2,000. Top up or ask to lower the amount.',
      );
      expect(prisma.wallet.update).not.toHaveBeenCalled();
      expect(prisma.ledgerEntry.create).not.toHaveBeenCalled();
    });

    it('turns into a 409 with the same sentence', () => {
      const http = new InsufficientCreditsError(1250, 2000).toHttp();
      expect(http).toBeInstanceOf(ConflictException);
      expect(http.message).toBe(
        'You have 1,250 credits; this milestone needs 2,000. Top up or ask to lower the amount.',
      );
    });

    it('moves the amount from available to held and writes one FUND_HOLD row', async () => {
      const { service, tx, wallets, ledgerRows } = createService({
        3: { available: 5000, held: 0 },
        9: { available: 5000, held: 0 },
      });

      await service.hold(tx, move);

      expect(wallets.get(3)).toEqual({ available: 3000, held: 2000 });
      expect(ledgerRows()).toEqual([
        {
          userId: 3,
          type: LedgerType.FUND_HOLD,
          availableDelta: -2000,
          heldDelta: 2000,
          availableAfter: 3000,
          heldAfter: 2000,
          contractId: 40,
          milestoneId: 41,
          counterpartyId: 9,
        },
      ]);
    });
  });

  describe('release', () => {
    it('writes two RELEASE rows whose after-values match the wallets', async () => {
      const { service, tx, wallets, ledgerRows } = createService({
        3: { available: 3000, held: 2000 },
        9: { available: 5000, held: 0 },
      });

      await service.release(tx, move);

      expect(wallets.get(3)).toEqual({ available: 3000, held: 0 });
      expect(wallets.get(9)).toEqual({ available: 7000, held: 0 });
      expect(ledgerRows()).toEqual([
        {
          userId: 3,
          type: LedgerType.RELEASE,
          availableDelta: 0,
          heldDelta: -2000,
          availableAfter: 3000,
          heldAfter: 0,
          contractId: 40,
          milestoneId: 41,
          counterpartyId: 9,
        },
        {
          userId: 9,
          type: LedgerType.RELEASE,
          availableDelta: 2000,
          heldDelta: 0,
          availableAfter: 7000,
          heldAfter: 0,
          contractId: 40,
          milestoneId: 41,
          counterpartyId: 3,
        },
      ]);
    });

    it('refuses when the client holds less than the amount (a bug, not a user mistake)', async () => {
      const { service, tx, prisma } = createService({
        3: { available: 3000, held: 500 },
        9: { available: 0, held: 0 },
      });

      await expect(service.release(tx, move)).rejects.toThrow(
        /holds 500 credits/,
      );
      expect(prisma.wallet.update).not.toHaveBeenCalled();
    });
  });

  describe('refund', () => {
    it('moves held back to available with one REFUND row', async () => {
      const { service, tx, wallets, ledgerRows } = createService({
        3: { available: 3000, held: 2000 },
        9: { available: 5000, held: 0 },
      });

      await service.refund(tx, move);

      expect(wallets.get(3)).toEqual({ available: 5000, held: 0 });
      expect(wallets.get(9)).toEqual({ available: 5000, held: 0 });
      expect(ledgerRows()).toEqual([
        {
          userId: 3,
          type: LedgerType.REFUND,
          availableDelta: 2000,
          heldDelta: -2000,
          availableAfter: 5000,
          heldAfter: 0,
          contractId: 40,
          milestoneId: 41,
          counterpartyId: 9,
        },
      ]);
    });
  });

  describe('creditTopUp', () => {
    it('adds the credits with one TOP_UP row linked to the top-up', async () => {
      const { service, tx, wallets, ledgerRows } = createService({
        5: { available: 100, held: 50 },
      });

      await service.creditTopUp(tx, { userId: 5, credits: 300, topUpId: 12 });

      expect(wallets.get(5)).toEqual({ available: 400, held: 50 });
      expect(ledgerRows()).toEqual([
        {
          userId: 5,
          type: LedgerType.TOP_UP,
          availableDelta: 300,
          heldDelta: 0,
          availableAfter: 400,
          heldAfter: 50,
          topUpId: 12,
        },
      ]);
    });
  });

  describe('summary', () => {
    it('creates the wallet if needed and sums paidOut and earned from RELEASE rows only', async () => {
      const { service, prisma, ledgerRows } = createService();
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { availableDelta: 1500, heldDelta: -2500 },
      });

      const summary = await service.summary(8);

      expect(ledgerRows()).toHaveLength(1); // the SEED row of the new wallet
      expect(prisma.ledgerEntry.aggregate).toHaveBeenCalledWith({
        where: { userId: 8, type: LedgerType.RELEASE },
        _sum: { availableDelta: true, heldDelta: true },
      });
      expect(summary).toEqual({
        available: 5000,
        held: 0,
        paidOut: 2500,
        earned: 1500,
        topUp: {
          enabled: false,
          minCredits: 10,
          maxCredits: 10000,
          vndPerCredit: 1000,
          currency: 'usd',
          centsPerCredit: 5,
        },
      });
    });

    it('reports topUp.enabled = true when the Stripe keys are set', async () => {
      const { service, prisma } = createService({}, true);
      prisma.ledgerEntry.aggregate.mockResolvedValue({ _sum: {} });
      expect((await service.summary(8)).topUp.enabled).toBe(true);
    });

    it('answers 0 paid out and 0 earned when there are no RELEASE rows', async () => {
      const { service, prisma } = createService({
        8: { available: 70, held: 30 },
      });
      prisma.ledgerEntry.aggregate.mockResolvedValue({
        _sum: { availableDelta: null, heldDelta: null },
      });

      const summary = await service.summary(8);

      expect(summary).toMatchObject({
        available: 70,
        held: 30,
        paidOut: 0,
        earned: 0,
      });
    });
  });

  describe('ledger', () => {
    it('pages the rows newest first and maps the links', async () => {
      const { service, prisma } = createService({
        8: { available: 0, held: 0 },
      });
      const createdAt = new Date('2026-11-24T10:00:00.000Z');
      prisma.ledgerEntry.count.mockResolvedValue(21);
      prisma.ledgerEntry.findMany.mockResolvedValue([
        {
          id: 5,
          type: LedgerType.RELEASE,
          availableDelta: 2000,
          heldDelta: 0,
          availableAfter: 7000,
          heldAfter: 0,
          topUpId: null,
          createdAt,
          contract: { id: 40, title: 'Logo' },
          milestone: { id: 41, position: 1, title: 'Sketches' },
          counterparty: { id: 3, name: 'Client', avatar: null },
        },
        {
          id: 4,
          type: LedgerType.SEED,
          availableDelta: 5000,
          heldDelta: 0,
          availableAfter: 5000,
          heldAfter: 0,
          topUpId: null,
          createdAt,
          contract: null,
          milestone: null,
          counterparty: null,
        },
      ]);

      const page = await service.ledger(8, 2, 10);

      const args = prisma.ledgerEntry.findMany.mock.calls[0][0] as {
        where: unknown;
        orderBy: unknown;
        skip: number;
        take: number;
      };
      expect(args.where).toEqual({ userId: 8 });
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      expect(args.skip).toBe(10);
      expect(args.take).toBe(10);
      expect(page.total).toBe(21);
      expect(page.totalPages).toBe(3);
      expect(page.page).toBe(2);
      expect(page.pageSize).toBe(10);
      expect(page.data[0]).toEqual({
        id: 5,
        type: LedgerType.RELEASE,
        availableDelta: 2000,
        heldDelta: 0,
        availableAfter: 7000,
        heldAfter: 0,
        contract: { id: 40, title: 'Logo' },
        milestone: { id: 41, position: 1, title: 'Sketches' },
        counterparty: { id: 3, name: 'Client', avatar: null },
        topUpId: null,
        createdAt: '2026-11-24T10:00:00.000Z',
      });
      expect(page.data[1].contract).toBeNull();
    });

    it('keeps pageSize at most 50', async () => {
      const { service, prisma } = createService({
        8: { available: 0, held: 0 },
      });

      const page = await service.ledger(8, 1, 500);

      const args = prisma.ledgerEntry.findMany.mock.calls[0][0] as {
        take: number;
      };
      expect(args.take).toBe(50);
      expect(page.pageSize).toBe(50);
    });
  });
});

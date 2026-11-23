import { ConflictException, Injectable } from '@nestjs/common';
import { LedgerType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { fmtCredits } from '../contracts/contract-rules';

/** Credits every user gets when their wallet is first made (the SEED row). */
export const STARTING_GRANT = 5000;
/** One top-up is 10 to 10,000 credits; 1 credit = 1,000 VND test money. */
export const TOP_UP_MIN_CREDITS = 10;
export const TOP_UP_MAX_CREDITS = 10000;
export const VND_PER_CREDIT = 1000;
/** The largest ledger page a request may ask for. */
export const LEDGER_MAX_PAGE_SIZE = 50;

/**
 * The client has fewer available credits than a milestone needs.
 * Callers turn it into HTTP 409 with toHttp(); the message is the sentence the user sees.
 */
export class InsufficientCreditsError extends Error {
  constructor(
    readonly available: number,
    readonly needed: number,
  ) {
    super(
      `You have ${fmtCredits(available)} credits; this milestone needs ${fmtCredits(needed)}. Top up or ask to lower the amount.`,
    );
    this.name = 'InsufficientCreditsError';
  }

  toHttp(): ConflictException {
    return new ConflictException(this.message);
  }
}

/** One move of a milestone's credits between the client and the freelancer. */
export type MilestoneMove = {
  clientId: number;
  freelancerId: number;
  amount: number;
  contractId: number;
  milestoneId: number;
};

export type Balance = { available: number; held: number };

export type WalletSummary = {
  available: number;
  held: number;
  /** Credits this user has paid to freelancers (released from their held credits). */
  paidOut: number;
  /** Credits this user has earned as a freelancer. */
  earned: number;
  topUp: {
    enabled: boolean;
    minCredits: number;
    maxCredits: number;
    vndPerCredit: number;
  };
};

export type LedgerEntryView = {
  id: number;
  type: LedgerType;
  availableDelta: number;
  heldDelta: number;
  availableAfter: number;
  heldAfter: number;
  contract: { id: number; title: string } | null;
  milestone: { id: number; position: number; title: string } | null;
  counterparty: { id: number; name: string; avatar: string | null } | null;
  topUpId: number | null;
  createdAt: string;
};

export type Paginated<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const ledgerInclude = {
  contract: { select: { id: true, title: true } },
  milestone: { select: { id: true, position: true, title: true } },
  counterparty: { select: { id: true, name: true, avatar: true } },
} satisfies Prisma.LedgerEntryInclude;

type LedgerRow = Prisma.LedgerEntryGetPayload<{
  include: typeof ledgerInclude;
}>;

/**
 * The demo credit wallet. Every money step of a contract runs inside the caller's transaction
 * (a group of database changes saved together or not at all), so the milestone change and the
 * credit move are saved together.
 *
 * Locks: lock() takes the wallet rows with SELECT ... FOR UPDATE ("these rows are mine until the
 * transaction ends"), always in ascending user id order. Two transactions that both need wallets 3
 * and 9 then always wait in the same order and never block each other forever (a deadlock).
 * Callers lock their contract (or proposal) row first, then the wallets.
 *
 * Every change writes a LedgerEntry row with the change (delta) and the balances after it, so the
 * wallet always equals the sum of its ledger.
 */
@Injectable()
export class WalletService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Makes the user's wallet if it does not exist yet, with the 5,000-credit SEED row.
   * INSERT ... ON CONFLICT DO NOTHING is safe when two requests of a new user arrive together:
   * the second insert waits for the first, then does nothing and returns no row, so only the
   * request that really made the wallet writes the SEED row.
   */
  async ensure(tx: Prisma.TransactionClient, userId: number): Promise<void> {
    const created = await tx.$queryRaw<{ userId: number }[]>`
      INSERT INTO "wallets" ("userId", "available", "held", "updatedAt")
      VALUES (${userId}, ${STARTING_GRANT}, 0, NOW())
      ON CONFLICT ("userId") DO NOTHING
      RETURNING "userId"`;
    if (created.length === 0) return;
    await tx.ledgerEntry.create({
      data: {
        userId,
        type: LedgerType.SEED,
        availableDelta: STARTING_GRANT,
        heldDelta: 0,
        availableAfter: STARTING_GRANT,
        heldAfter: 0,
      },
    });
  }

  /**
   * Makes (ensure) and locks the wallets of these users, in ascending user id order.
   * Answers each user's balance read after the lock.
   */
  async lock(
    tx: Prisma.TransactionClient,
    userIds: number[],
  ): Promise<Map<number, Balance>> {
    const ids = [...new Set(userIds)].sort((a, b) => a - b);
    for (const id of ids) {
      await this.ensure(tx, id);
    }
    // ORDER BY before FOR UPDATE: Postgres takes the row locks in this order.
    const rows = await tx.$queryRaw<
      { userId: number; available: number; held: number }[]
    >`
      SELECT "userId", "available", "held" FROM "wallets"
      WHERE "userId" = ANY(${ids}::int[])
      ORDER BY "userId"
      FOR UPDATE`;
    return new Map(
      rows.map((r) => [
        r.userId,
        { available: Number(r.available), held: Number(r.held) },
      ]),
    );
  }

  /** Funding: the client's available goes down and held goes up by the amount (FUND_HOLD). */
  async hold(tx: Prisma.TransactionClient, a: MilestoneMove): Promise<void> {
    const wallets = await this.lock(tx, [a.clientId, a.freelancerId]);
    const client = wallets.get(a.clientId)!;
    if (client.available < a.amount) {
      throw new InsufficientCreditsError(client.available, a.amount);
    }
    await this.change(tx, {
      userId: a.clientId,
      type: LedgerType.FUND_HOLD,
      availableDelta: -a.amount,
      heldDelta: a.amount,
      links: this.links(a, a.freelancerId),
    });
  }

  /**
   * Approval: the client's held goes down (RELEASE row of the client) and the freelancer's
   * available goes up (RELEASE row of the freelancer).
   */
  async release(tx: Prisma.TransactionClient, a: MilestoneMove): Promise<void> {
    await this.lockHeld(tx, a);
    await this.change(tx, {
      userId: a.clientId,
      type: LedgerType.RELEASE,
      availableDelta: 0,
      heldDelta: -a.amount,
      links: this.links(a, a.freelancerId),
    });
    await this.change(tx, {
      userId: a.freelancerId,
      type: LedgerType.RELEASE,
      availableDelta: a.amount,
      heldDelta: 0,
      links: this.links(a, a.clientId),
    });
  }

  /** Refund: the held credits go back to the client's available (one REFUND row). */
  async refund(tx: Prisma.TransactionClient, a: MilestoneMove): Promise<void> {
    await this.lockHeld(tx, a);
    await this.change(tx, {
      userId: a.clientId,
      type: LedgerType.REFUND,
      availableDelta: a.amount,
      heldDelta: -a.amount,
      links: this.links(a, a.freelancerId),
    });
  }

  /** A paid top-up: the credits are added to available (TOP_UP row linked to the top-up). */
  async creditTopUp(
    tx: Prisma.TransactionClient,
    a: { userId: number; credits: number; topUpId: number },
  ): Promise<void> {
    await this.lock(tx, [a.userId]);
    await this.change(tx, {
      userId: a.userId,
      type: LedgerType.TOP_UP,
      availableDelta: a.credits,
      heldDelta: 0,
      links: { topUpId: a.topUpId },
    });
  }

  /** The wallet page header. Makes the wallet on the first call. */
  async summary(userId: number): Promise<WalletSummary> {
    const wallet = await this.prisma.$transaction(async (tx) => {
      await this.ensure(tx, userId);
      return tx.wallet.findUnique({ where: { userId } });
    });
    // Only RELEASE rows count: the client's rows have heldDelta < 0 (paid out), the
    // freelancer's rows have availableDelta > 0 (earned). Imported contracts write no rows.
    const sums = await this.prisma.ledgerEntry.aggregate({
      where: { userId, type: LedgerType.RELEASE },
      _sum: { availableDelta: true, heldDelta: true },
    });
    return {
      available: wallet?.available ?? 0,
      held: wallet?.held ?? 0,
      // "0 -" and not "-": -(0) would be -0.
      paidOut: 0 - (sums._sum.heldDelta ?? 0),
      earned: sums._sum.availableDelta ?? 0,
      topUp: {
        // Turned on by the VNPay top-up task.
        enabled: false,
        minCredits: TOP_UP_MIN_CREDITS,
        maxCredits: TOP_UP_MAX_CREDITS,
        vndPerCredit: VND_PER_CREDIT,
      },
    };
  }

  /** The user's ledger, newest first. Makes the wallet first so a new user sees the SEED row. */
  async ledger(
    userId: number,
    page: number,
    pageSize: number,
  ): Promise<Paginated<LedgerEntryView>> {
    const size = Math.min(Math.max(1, pageSize), LEDGER_MAX_PAGE_SIZE);
    const current = Math.max(1, page);
    await this.prisma.$transaction((tx) => this.ensure(tx, userId));
    const where = { userId };
    const [rows, total] = await Promise.all([
      this.prisma.ledgerEntry.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (current - 1) * size,
        take: size,
        include: ledgerInclude,
      }),
      this.prisma.ledgerEntry.count({ where }),
    ]);
    return {
      data: rows.map((r) => this.view(r)),
      total,
      page: current,
      pageSize: size,
      totalPages: Math.ceil(total / size),
    };
  }

  /** Locks both wallets of a move and checks the client really holds the amount. */
  private async lockHeld(
    tx: Prisma.TransactionClient,
    a: MilestoneMove,
  ): Promise<void> {
    const wallets = await this.lock(tx, [a.clientId, a.freelancerId]);
    const held = wallets.get(a.clientId)!.held;
    if (held < a.amount) {
      // A bug in the caller, not a user mistake: the milestone says funded but the credits are not held.
      throw new Error(
        `Client ${a.clientId} holds ${held} credits; milestone ${a.milestoneId} needs ${a.amount} held.`,
      );
    }
  }

  private links(a: MilestoneMove, counterpartyId: number) {
    return {
      contractId: a.contractId,
      milestoneId: a.milestoneId,
      counterpartyId,
    };
  }

  /** Changes one locked wallet and writes its ledger row with the balances after the change. */
  private async change(
    tx: Prisma.TransactionClient,
    c: {
      userId: number;
      type: LedgerType;
      availableDelta: number;
      heldDelta: number;
      links: {
        contractId?: number;
        milestoneId?: number;
        counterpartyId?: number;
        topUpId?: number;
      };
    },
  ): Promise<void> {
    const wallet = await tx.wallet.update({
      where: { userId: c.userId },
      data: {
        ...(c.availableDelta
          ? { available: { increment: c.availableDelta } }
          : {}),
        ...(c.heldDelta ? { held: { increment: c.heldDelta } } : {}),
      },
    });
    await tx.ledgerEntry.create({
      data: {
        userId: c.userId,
        type: c.type,
        availableDelta: c.availableDelta,
        heldDelta: c.heldDelta,
        availableAfter: wallet.available,
        heldAfter: wallet.held,
        ...c.links,
      },
    });
  }

  private view(r: LedgerRow): LedgerEntryView {
    return {
      id: r.id,
      type: r.type,
      availableDelta: r.availableDelta,
      heldDelta: r.heldDelta,
      availableAfter: r.availableAfter,
      heldAfter: r.heldAfter,
      contract: r.contract,
      milestone: r.milestone,
      counterparty: r.counterparty,
      topUpId: r.topUpId,
      createdAt: r.createdAt.toISOString(),
    };
  }
}

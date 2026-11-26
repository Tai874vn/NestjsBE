import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TopUpStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../../prisma.service';
import { CheckoutSession, StripeEvent, StripeService } from './stripe.service';
import { VND_PER_CREDIT, WalletService } from './wallet.service';

/** Stripe charges US dollars: 1 credit = 5 cents, so the 10-credit minimum is Stripe's 0.50 USD minimum. */
export const TOP_UP_CURRENCY = 'usd';
export const CENTS_PER_CREDIT = 5;

/** What happened to one payment answer (webhook or session lookup). */
export type SettleOutcome =
  | 'credited'
  | 'already_done'
  | 'not_found'
  | 'amount_mismatch'
  | 'not_paid'
  | 'failed'
  | 'ignored';

export type TopUpView = {
  topUpId: number;
  status: TopUpStatus;
  credits: number;
  available: number;
};

/** The webhook is the normal way a top-up finishes; the session lookup only helps when it is late. */
export const LOOKUP_AFTER_MS = 15_000;

/**
 * Stripe Checkout top-ups in test mode (test cards only, no real money).
 * start() saves a PENDING top-up, asks Stripe for a hosted Checkout page and answers its URL.
 * Stripe then sends a signed webhook (checkout.session.completed) and that credits the wallet.
 * The browser comes back on the return page, which asks status(); if the webhook has not arrived
 * yet, status() asks Stripe about the session itself.
 * Credits are added at most once: settle() locks the top-up row (SELECT ... FOR UPDATE) and only
 * a PENDING row can become PAID (Stripe may send the same event more than once).
 */
@Injectable()
export class TopUpsService {
  private readonly logger = new Logger(TopUpsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly stripe: StripeService,
    private readonly config: ConfigService,
  ) {}

  async start(
    userId: number,
    credits: number,
  ): Promise<{ topUpId: number; checkoutUrl: string }> {
    if (!this.stripe.isConfigured()) {
      throw new ServiceUnavailableException('Top up is not set up.');
    }
    const amountMinor = credits * CENTS_PER_CREDIT;
    const topUp = await this.prisma.$transaction(async (tx) => {
      // The reference needs the row id, so the row is saved with a one-off ref first.
      const row = await tx.topUp.create({
        data: {
          userId,
          credits,
          amountVnd: credits * VND_PER_CREDIT,
          amountMinor,
          currency: TOP_UP_CURRENCY,
          provider: 'STRIPE',
          txnRef: `new-${randomBytes(12).toString('hex')}`,
        },
      });
      return tx.topUp.update({
        where: { id: row.id },
        // A random tail, so a reference is never reused even if ids restart (a fresh database).
        data: { txnRef: `JA${row.id}-${randomBytes(3).toString('hex')}` },
      });
    });
    const back = (result: string) =>
      `${this.frontendUrl()}/wallet/top-up/return?topUp=${topUp.id}&result=${result}`;
    let session: CheckoutSession;
    try {
      session = await this.stripe.createCheckoutSession({
        reference: topUp.txnRef,
        credits,
        currency: TOP_UP_CURRENCY,
        amountMinor,
        successUrl: back('success'),
        cancelUrl: back('cancel'),
      });
    } catch (error) {
      this.logger.error(
        `Stripe checkout failed for ${topUp.txnRef}: ${(error as Error).message}`,
      );
      await this.prisma.topUp.update({
        where: { id: topUp.id },
        data: { status: TopUpStatus.FAILED },
      });
      throw new ServiceUnavailableException(
        'Could not open the payment page. Try again.',
      );
    }
    if (!session.url) {
      throw new ServiceUnavailableException(
        'Could not open the payment page. Try again.',
      );
    }
    await this.prisma.topUp.update({
      where: { id: topUp.id },
      data: { gatewayTransactionId: session.id },
    });
    return { topUpId: topUp.id, checkoutUrl: session.url };
  }

  /** A verified Stripe event (the controller has checked the signature). */
  async handleEvent(event: StripeEvent): Promise<SettleOutcome> {
    const session = event.data?.object;
    const reference = session?.client_reference_id;
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        if (!reference) return 'not_found';
        // A delayed method (e.g. a bank debit) completes "unpaid" first and succeeds later.
        if (session.payment_status !== 'paid') return 'not_paid';
        return this.settle(reference, session);
      case 'checkout.session.async_payment_failed':
      case 'checkout.session.expired':
        if (!reference) return 'not_found';
        return this.fail(reference);
      default:
        return 'ignored';
    }
  }

  /**
   * The return page asks this (and asks again while it says PENDING). Another user's top-up
   * answers 404, as if it did not exist.
   */
  async status(
    userId: number,
    topUpId: number,
    now = new Date(),
  ): Promise<TopUpView> {
    let topUp = await this.prisma.topUp.findUnique({ where: { id: topUpId } });
    if (!topUp || topUp.userId !== userId) {
      throw new NotFoundException('Top up not found.');
    }
    if (
      topUp.status === TopUpStatus.PENDING &&
      topUp.provider === 'STRIPE' &&
      topUp.gatewayTransactionId &&
      now.getTime() - topUp.createdAt.getTime() >= LOOKUP_AFTER_MS
    ) {
      const session = await this.stripe.retrieveSession(
        topUp.gatewayTransactionId,
      );
      if (session?.payment_status === 'paid') {
        await this.settle(topUp.txnRef, session);
      } else if (session?.status === 'expired') {
        await this.fail(topUp.txnRef);
      }
      topUp = (await this.prisma.topUp.findUnique({ where: { id: topUpId } }))!;
    }
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return {
      topUpId: topUp.id,
      status: topUp.status,
      credits: topUp.credits,
      available: wallet?.available ?? 0,
    };
  }

  /** Locks the row; only PENDING → PAID, and only when Stripe charged exactly our amount. */
  private settle(
    reference: string,
    session: CheckoutSession,
  ): Promise<SettleOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "top_ups" WHERE "txnRef" = ${reference} FOR UPDATE`;
      if (locked.length === 0) return 'not_found' as const;
      // Read after the lock, so the status is the latest one.
      const topUp = (await tx.topUp.findUnique({
        where: { id: locked[0].id },
      }))!;
      if (topUp.status !== TopUpStatus.PENDING) return 'already_done' as const;
      if (
        session.amount_total !== topUp.amountMinor ||
        session.currency?.toLowerCase() !== topUp.currency
      ) {
        return 'amount_mismatch' as const;
      }
      await tx.topUp.update({
        where: { id: topUp.id },
        data: {
          status: TopUpStatus.PAID,
          gatewayTransactionId: session.id ?? topUp.gatewayTransactionId,
          paidAt: new Date(),
        },
      });
      await this.wallet.creditTopUp(tx, {
        userId: topUp.userId,
        credits: topUp.credits,
        topUpId: topUp.id,
      });
      return 'credited' as const;
    });
  }

  /** PENDING → FAILED (payment failed or the Checkout page expired). A PAID row never changes. */
  private async fail(reference: string): Promise<SettleOutcome> {
    const { count } = await this.prisma.topUp.updateMany({
      where: { txnRef: reference, status: TopUpStatus.PENDING },
      data: { status: TopUpStatus.FAILED },
    });
    return count === 1 ? 'failed' : 'already_done';
  }

  private frontendUrl(): string {
    return this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
  }
}

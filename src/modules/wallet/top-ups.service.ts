import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TopUpStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { CheckoutForm, SepayService } from './sepay.service';
import { VND_PER_CREDIT, WalletService } from './wallet.service';

/** The part of SePay's IPN body we read (developer.sepay.vn → Cổng thanh toán → IPN). */
export type SepayIpn = {
  notification_type?: string;
  order?: {
    order_invoice_number?: string;
    order_amount?: string | number;
    order_status?: string;
  };
  transaction?: {
    transaction_id?: string;
    transaction_status?: string;
    payment_method?: string;
  };
};

/** What happened to one payment answer (IPN or order lookup). */
export type SettleOutcome =
  | 'credited'
  | 'already_done'
  | 'not_found'
  | 'amount_mismatch'
  | 'not_paid';

export type TopUpView = {
  topUpId: number;
  status: TopUpStatus;
  credits: number;
  available: number;
};

/** The IPN is the normal way a top-up finishes; the order lookup only helps when it is late. */
export const LOOKUP_AFTER_MS = 15_000;

/** A SePay answer that means "paid". */
function isPaid(orderStatus?: string, transactionStatus?: string): boolean {
  return orderStatus === 'CAPTURED' || transactionStatus === 'APPROVED';
}

/** SePay sends amounts like "100000.00"; compare as whole VND. */
function sameAmount(given: string | number | undefined, amountVnd: number) {
  const value = typeof given === 'number' ? given : Number(given);
  return Number.isFinite(value) && Math.round(value) === amountVnd;
}

/**
 * SePay sandbox top-ups (test money only: 1 credit = 1,000 VND).
 * start() saves a PENDING top-up and answers a signed form; the browser posts it to SePay.
 * SePay then calls our IPN (server to server) with the result, and that credits the wallet.
 * The browser comes back on the return page, which asks status(); if the IPN has not arrived
 * yet, status() asks SePay about the order itself.
 * Credits are added at most once: settle() locks the top-up row (SELECT ... FOR UPDATE) and
 * only a PENDING row can become PAID.
 */
@Injectable()
export class TopUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly sepay: SepayService,
    private readonly config: ConfigService,
  ) {}

  async start(
    userId: number,
    credits: number,
  ): Promise<{ topUpId: number; checkout: CheckoutForm }> {
    if (!this.sepay.isConfigured()) {
      throw new ServiceUnavailableException('Top up is not set up.');
    }
    const amountVnd = credits * VND_PER_CREDIT;
    const topUp = await this.prisma.$transaction(async (tx) => {
      // The invoice number needs the row id, so the row is saved with a one-off ref first.
      const row = await tx.topUp.create({
        data: {
          userId,
          credits,
          amountVnd,
          provider: 'SEPAY',
          txnRef: `new-${randomBytes(12).toString('hex')}`,
        },
      });
      return tx.topUp.update({
        where: { id: row.id },
        // A random tail, so a number is never reused even if ids restart (a fresh database).
        data: { txnRef: `JA${row.id}-${randomBytes(3).toString('hex')}` },
      });
    });
    const back = (result: string) =>
      `${this.frontendUrl()}/wallet/top-up/return?topUp=${topUp.id}&result=${result}`;
    const checkout = this.sepay.checkoutForm({
      invoiceNumber: topUp.txnRef,
      amountVnd,
      description: `JobAura top up ${credits} credits`,
      successUrl: back('success'),
      errorUrl: back('error'),
      cancelUrl: back('cancel'),
    });
    return { topUpId: topUp.id, checkout };
  }

  /** SePay's IPN. The caller has already checked X-Secret-Key. */
  async handleIpn(body: SepayIpn): Promise<SettleOutcome> {
    if (body?.notification_type !== 'ORDER_PAID') return 'not_paid';
    const invoice = body.order?.order_invoice_number;
    if (!invoice) return 'not_found';
    return this.settle(invoice, {
      amount: body.order?.order_amount,
      paid: isPaid(
        body.order?.order_status,
        body.transaction?.transaction_status,
      ),
      transactionId: body.transaction?.transaction_id,
      paymentMethod: body.transaction?.payment_method,
    });
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
      topUp.provider === 'SEPAY' &&
      now.getTime() - topUp.createdAt.getTime() >= LOOKUP_AFTER_MS
    ) {
      const order = await this.sepay.fetchOrder(topUp.txnRef);
      const transaction = order?.transactions?.[0];
      if (
        order &&
        isPaid(order.order_status, transaction?.transaction_status)
      ) {
        await this.settle(topUp.txnRef, {
          amount: order.order_amount,
          paid: true,
          transactionId: transaction?.transaction_id ?? order.transaction_id,
          paymentMethod: transaction?.payment_method,
        });
        topUp = (await this.prisma.topUp.findUnique({
          where: { id: topUpId },
        }))!;
      }
    }
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return {
      topUpId: topUp.id,
      status: topUp.status,
      credits: topUp.credits,
      available: wallet?.available ?? 0,
    };
  }

  /** Locks the row; only PENDING → PAID, and only when the paid amount is exactly ours. */
  private settle(
    invoice: string,
    result: {
      amount: string | number | undefined;
      paid: boolean;
      transactionId?: string;
      paymentMethod?: string;
    },
  ): Promise<SettleOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "top_ups" WHERE "txnRef" = ${invoice} FOR UPDATE`;
      if (locked.length === 0) return 'not_found' as const;
      // Read after the lock, so the status is the latest one.
      const topUp = (await tx.topUp.findUnique({
        where: { id: locked[0].id },
      }))!;
      if (topUp.status !== TopUpStatus.PENDING) return 'already_done' as const;
      if (!sameAmount(result.amount, topUp.amountVnd))
        return 'amount_mismatch' as const;
      if (!result.paid) return 'not_paid' as const;
      await tx.topUp.update({
        where: { id: topUp.id },
        data: {
          status: TopUpStatus.PAID,
          gatewayTransactionId: result.transactionId ?? null,
          paymentMethod: result.paymentMethod ?? null,
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

  private frontendUrl(): string {
    return this.config.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
  }
}

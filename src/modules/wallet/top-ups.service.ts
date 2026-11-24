import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { TopUp, TopUpStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { VnpayService } from './vnpay.service';
import { VND_PER_CREDIT, WalletService } from './wallet.service';

/** VNPay's IPN answer codes (RspCode) this service gives. */
export type TopUpCode = '00' | '01' | '02' | '04' | '97';

/** The Message VNPay expects with each RspCode (their sandbox docs). */
export const IPN_MESSAGES: Record<TopUpCode | '99', string> = {
  '00': 'Confirm Success',
  '01': 'Order not found',
  '02': 'Order already confirmed',
  '04': 'Invalid amount',
  '97': 'Invalid signature',
  '99': 'Unknown error',
};

export type TopUpReturn = {
  status: TopUpStatus;
  credits: number;
  available: number;
};

/**
 * VNPay sandbox top-ups (test money only: 1 credit = 1,000 VND).
 * start() saves a PENDING top-up and answers the VNPay page URL. VNPay then calls us twice with
 * the same signed result: the browser comes back on the return URL, and VNPay's server calls the
 * IPN (its server-to-server callback). Both run complete(), which credits the wallet at most once:
 * the top-up row is locked first (SELECT ... FOR UPDATE), and only a PENDING row can change, so
 * whichever call comes second finds it PAID or FAILED and answers 02.
 */
@Injectable()
export class TopUpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly wallet: WalletService,
    private readonly vnpay: VnpayService,
  ) {}

  async start(
    userId: number,
    credits: number,
    ipAddr: string,
  ): Promise<{ topUpId: number; payUrl: string }> {
    if (!this.vnpay.isConfigured()) {
      throw new ServiceUnavailableException('Top up is not set up.');
    }
    const amountVnd = credits * VND_PER_CREDIT;
    const topUp = await this.prisma.$transaction(async (tx) => {
      // The ref needs the row id, so the row is saved with a one-off ref first and renamed.
      const row = await tx.topUp.create({
        data: {
          userId,
          credits,
          amountVnd,
          txnRef: `new-${randomBytes(12).toString('hex')}`,
        },
      });
      return tx.topUp.update({
        where: { id: row.id },
        // A random tail, so a ref is never reused even if ids restart (a fresh database).
        data: { txnRef: `JA${row.id}-${randomBytes(3).toString('hex')}` },
      });
    });
    const payUrl = this.vnpay.buildPayUrl({
      txnRef: topUp.txnRef,
      amountVnd,
      orderInfo: `JobAura top up ${credits} credits`,
      ipAddr,
      now: new Date(),
    });
    return { topUpId: topUp.id, payUrl };
  }

  /** Hash checked first. Locks the TopUp row; only PENDING → PAID/FAILED; PAID credits the wallet once. */
  async complete(
    query: Record<string, string>,
  ): Promise<{ code: TopUpCode; topUp?: TopUp }> {
    if (!this.vnpay.verify(query)) return { code: '97' };
    const txnRef = query.vnp_TxnRef;
    if (!txnRef) return { code: '01' };
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: number }[]>`
        SELECT "id" FROM "top_ups" WHERE "txnRef" = ${txnRef} FOR UPDATE`;
      if (locked.length === 0) return { code: '01' as const };
      // Read after the lock, so the status is the latest one.
      const topUp = (await tx.topUp.findUnique({
        where: { id: locked[0].id },
      }))!;
      // vnp_Amount is in 1/100 VND.
      if (query.vnp_Amount !== String(topUp.amountVnd * 100)) {
        return { code: '04' as const, topUp };
      }
      if (topUp.status !== TopUpStatus.PENDING) {
        return { code: '02' as const, topUp };
      }
      const paid =
        query.vnp_ResponseCode === '00' && query.vnp_TransactionStatus === '00';
      const updated = await tx.topUp.update({
        where: { id: topUp.id },
        data: {
          status: paid ? TopUpStatus.PAID : TopUpStatus.FAILED,
          responseCode: query.vnp_ResponseCode ?? null,
          vnpTransactionNo: query.vnp_TransactionNo ?? null,
          bankCode: query.vnp_BankCode ?? null,
          paidAt: paid ? new Date() : null,
        },
      });
      if (paid) {
        await this.wallet.creditTopUp(tx, {
          userId: topUp.userId,
          credits: topUp.credits,
          topUpId: topUp.id,
        });
      }
      return { code: '00' as const, topUp: updated };
    });
  }

  /**
   * The browser's way back from VNPay. It runs the same complete() as the IPN, so a local test
   * works without a public IPN URL. Another user's top-up answers 404 (as if it did not exist).
   */
  async finishReturn(
    userId: number,
    query: Record<string, string>,
  ): Promise<TopUpReturn> {
    const { code, topUp } = await this.complete(query);
    if (code === '97') {
      throw new BadRequestException('The payment answer is not valid.');
    }
    if (!topUp || topUp.userId !== userId) {
      throw new NotFoundException('Top up not found.');
    }
    if (code === '04') {
      throw new BadRequestException(
        'The paid amount does not match this top up.',
      );
    }
    const wallet = await this.prisma.wallet.findUnique({ where: { userId } });
    return {
      status: topUp.status,
      credits: topUp.credits,
      available: wallet?.available ?? 0,
    };
  }
}

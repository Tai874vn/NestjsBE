import { Injectable } from '@nestjs/common';
import {
  AmendmentStatus,
  ContractStatus,
  MilestoneStatus,
  Prisma,
} from '@prisma/client';
import { WalletService } from '../wallet/wallet.service';
import { HELD_STATUSES } from './contract-rules';
import { ContractEventsService, EndReason } from './contract-events.service';

const M = MilestoneStatus;

/** The parts of a locked contract that ending reads. */
export type EndingContract = {
  id: number;
  clientId: number;
  freelancerId: number;
  milestones: {
    id: number;
    position: number;
    amount: number;
    status: MilestoneStatus;
  }[];
};

export type EndOptions = {
  /** For a SUBMITTED milestone: APPROVE pays the freelancer, REFUND (the default) gives it back. */
  submittedChoice?: 'APPROVE' | 'REFUND';
  /** Who ended it; null (the default) when the sweeper did. */
  actorId?: number | null;
  now?: Date;
};

/** What ending did to each milestone (for the notice texts). */
export type EndResult = {
  released: number[];
  refunded: number[];
  cancelled: number[];
};

/**
 * Stops a contract early (ENDED). Used by the client's own end (Task 8), the mutual end
 * (Task 9) and the sweeper (Task 10).
 *
 * The caller must already hold the contract row lock (see ContractStepService) and pass the
 * milestones it read AFTER the lock, inside the same transaction. The credit moves lock the
 * wallets after the contract (WalletService, ascending user id).
 *
 * - Held milestones (FUNDED, CHANGES_REQUESTED, SUBMITTED) are refunded to the client and become
 *   CANCELLED. A SUBMITTED one is released to the freelancer instead (APPROVED) when
 *   submittedChoice = 'APPROVE'.
 * - PENDING (not funded) milestones become CANCELLED.
 * - APPROVED milestones and their submissions stay as they are (the client keeps the work).
 * - An OPEN amendment is CANCELLED and an open end request is cleared.
 */
@Injectable()
export class ContractEndingService {
  constructor(
    private readonly wallet: WalletService,
    private readonly events: ContractEventsService,
  ) {}

  async end(
    tx: Prisma.TransactionClient,
    contract: EndingContract,
    reason: EndReason,
    opts: EndOptions = {},
  ): Promise<EndResult> {
    const now = opts.now ?? new Date();
    const actorId = opts.actorId ?? null;
    const result: EndResult = { released: [], refunded: [], cancelled: [] };

    for (const m of contract.milestones) {
      const move = {
        clientId: contract.clientId,
        freelancerId: contract.freelancerId,
        amount: m.amount,
        contractId: contract.id,
        milestoneId: m.id,
      };
      const ids = { milestoneId: m.id, position: m.position };
      if (m.status === M.SUBMITTED && opts.submittedChoice === 'APPROVE') {
        await this.wallet.release(tx, move);
        await tx.milestone.update({
          where: { id: m.id },
          data: { status: M.APPROVED, approvedAt: now },
        });
        await this.events.record(tx, {
          contractId: contract.id,
          actorId,
          type: 'milestone_approved',
          data: { ...ids, amount: m.amount, auto: false },
        });
        result.released.push(m.position);
      } else if (HELD_STATUSES.includes(m.status)) {
        await this.wallet.refund(tx, move);
        await tx.milestone.update({
          where: { id: m.id },
          data: { status: M.CANCELLED, cancelledAt: now },
        });
        await this.events.record(tx, {
          contractId: contract.id,
          actorId,
          type: 'milestone_refunded',
          data: { ...ids, amount: m.amount },
        });
        result.refunded.push(m.position);
      } else if (m.status === M.PENDING) {
        await tx.milestone.update({
          where: { id: m.id },
          data: { status: M.CANCELLED, cancelledAt: now },
        });
        await this.events.record(tx, {
          contractId: contract.id,
          actorId,
          type: 'milestone_cancelled',
          data: ids,
        });
        result.cancelled.push(m.position);
      }
    }

    await tx.amendment.updateMany({
      where: { contractId: contract.id, status: AmendmentStatus.OPEN },
      data: { status: AmendmentStatus.CANCELLED, decidedAt: now },
    });
    await tx.contract.update({
      where: { id: contract.id },
      data: {
        status: ContractStatus.ENDED,
        endReason: reason,
        endedAt: now,
        endRequestedById: null,
        endRequestNote: null,
        endRequestChoice: null,
        endRequestedAt: null,
      },
    });
    await this.events.record(tx, {
      contractId: contract.id,
      actorId,
      type: 'contract_ended',
      data: { reason },
    });
    return result;
  }
}

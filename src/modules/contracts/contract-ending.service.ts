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

/**
 * Clears the client's stored end-request choice (APPROVE or REFUND for submitted work) and the
 * work it was made for. Used when that work changes (new submission, changes requested,
 * approved), so an old APPROVE can never pay for work the client has not seen. The end request
 * itself stays open; accepting it while work is SUBMITTED then needs a new request (409).
 */
export const CLEAR_END_CHOICE = {
  endRequestChoice: null,
  endRequestMilestoneId: null,
  endRequestSubmissionId: null,
} satisfies Prisma.ContractUncheckedUpdateInput;

/** Clears the whole open end request. */
export const CLEAR_END_REQUEST = {
  ...CLEAR_END_CHOICE,
  endRequestedById: null,
  endRequestNote: null,
  endRequestedAt: null,
} satisfies Prisma.ContractUncheckedUpdateInput;

/** The parts of a locked contract that ending reads. */
export type EndingContract = {
  id: number;
  clientId: number;
  freelancerId: number;
  /** The stored end-request choice, when the caller read it (cleared on approve). */
  endRequestChoice?: string | null;
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

/** Who approves a milestone and when; auto = true when the sweeper does it (client silent). */
export type ApproveOptions = {
  actorId: number | null;
  now: Date;
  auto: boolean;
};

/** What ending did to each milestone (for the notice texts). */
export type EndResult = {
  released: number[];
  refunded: number[];
  /** Credits refunded to the client in all. */
  refundedAmount: number;
  cancelled: number[];
};

/**
 * The two money endings of a contract that several steps share.
 *
 * approveMilestone(): the one approve path (RELEASE, APPROVED, history, COMPLETED when last). Used
 * by the client's Approve (ContractsService) and the sweeper's auto-approve (ContractSweeperService).
 *
 * end(): stops a contract early (ENDED). Used by the client's own end (Task 8), the mutual end
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

  /**
   * Approve one SUBMITTED milestone: the held credits go to the freelancer (RELEASE), the milestone
   * becomes APPROVED (autoApproved when the sweeper did it) and a milestone_approved row is
   * written. When every other milestone is APPROVED or CANCELLED, the contract is COMPLETED and a
   * contract_completed row is written. The caller holds the contract row lock and has already
   * checked that the milestone may be approved (it read it after the lock).
   */
  async approveMilestone(
    tx: Prisma.TransactionClient,
    contract: EndingContract,
    m: EndingContract['milestones'][number],
    opts: ApproveOptions,
  ): Promise<{ completed: boolean }> {
    const { actorId, now, auto } = opts;
    await this.wallet.release(tx, {
      clientId: contract.clientId,
      freelancerId: contract.freelancerId,
      amount: m.amount,
      contractId: contract.id,
      milestoneId: m.id,
    });
    await tx.milestone.update({
      where: { id: m.id },
      data: {
        status: M.APPROVED,
        approvedAt: now,
        ...(auto ? { autoApproved: true } : {}),
      },
    });
    await this.events.record(tx, {
      contractId: contract.id,
      actorId,
      type: 'milestone_approved',
      data: { milestoneId: m.id, position: m.position, amount: m.amount, auto },
    });
    const completed = contract.milestones.every(
      (other) =>
        other.id === m.id ||
        other.status === M.APPROVED ||
        other.status === M.CANCELLED,
    );
    if (completed) {
      // A finished contract keeps no open change request or end request (their buttons would
      // only answer 409).
      await tx.amendment.updateMany({
        where: { contractId: contract.id, status: AmendmentStatus.OPEN },
        data: { status: AmendmentStatus.CANCELLED, decidedAt: now },
      });
      await tx.contract.update({
        where: { id: contract.id },
        data: {
          status: ContractStatus.COMPLETED,
          completedAt: now,
          ...CLEAR_END_REQUEST,
        },
      });
      await this.events.record(tx, {
        contractId: contract.id,
        actorId,
        type: 'contract_completed',
      });
    } else if (contract.endRequestChoice) {
      // The approved work is no longer the work the client's end-request choice was made for.
      await tx.contract.update({
        where: { id: contract.id },
        data: CLEAR_END_CHOICE,
      });
    }
    return { completed };
  }

  async end(
    tx: Prisma.TransactionClient,
    contract: EndingContract,
    reason: EndReason,
    opts: EndOptions = {},
  ): Promise<EndResult> {
    const now = opts.now ?? new Date();
    const actorId = opts.actorId ?? null;
    const result: EndResult = {
      released: [],
      refunded: [],
      refundedAmount: 0,
      cancelled: [],
    };

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
        result.refundedAmount += m.amount;
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
        ...CLEAR_END_REQUEST,
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

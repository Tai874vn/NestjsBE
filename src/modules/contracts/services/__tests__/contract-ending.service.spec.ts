import {
  AmendmentStatus,
  ContractStatus,
  MilestoneStatus,
} from '@prisma/client';
import { ContractEndingService } from '../contract-ending.service';

const M = MilestoneStatus;

function setup() {
  const tx = {
    milestone: { update: jest.fn().mockResolvedValue({}) },
    amendment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    contract: { update: jest.fn().mockResolvedValue({}) },
  };
  const wallet = {
    release: jest.fn().mockResolvedValue(undefined),
    refund: jest.fn().mockResolvedValue(undefined),
  };
  const events = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ContractEndingService(wallet as never, events as never);
  return { tx, wallet, events, service };
}

const contract = {
  id: 20,
  clientId: 3,
  freelancerId: 9,
  milestones: [
    { id: 31, position: 1, amount: 300, status: M.APPROVED },
    { id: 32, position: 2, amount: 400, status: M.SUBMITTED },
    { id: 33, position: 3, amount: 500, status: M.PENDING },
  ],
};

function move(milestoneId: number, amount: number) {
  return { clientId: 3, freelancerId: 9, amount, contractId: 20, milestoneId };
}

/** The status each milestone was changed to, by id. */
function statusUpdates(tx: ReturnType<typeof setup>['tx']) {
  return Object.fromEntries(
    tx.milestone.update.mock.calls.map(
      ([arg]: [
        { where: { id: number }; data: { status: MilestoneStatus } },
      ]) => [arg.where.id, arg.data.status],
    ),
  );
}

describe('ContractEndingService.end', () => {
  it('SUBMITTED with APPROVE: release, milestone APPROVED; PENDING cancelled; APPROVED untouched', async () => {
    const { tx, wallet, events, service } = setup();
    const now = new Date('2026-12-01T10:00:00Z');

    const result = await service.end(tx as never, contract, 'MUTUAL', {
      submittedChoice: 'APPROVE',
      actorId: 9,
      now,
    });

    expect(wallet.release).toHaveBeenCalledTimes(1);
    expect(wallet.release).toHaveBeenCalledWith(tx, move(32, 400));
    expect(wallet.refund).not.toHaveBeenCalled();
    expect(statusUpdates(tx)).toEqual({ 32: M.APPROVED, 33: M.CANCELLED });
    expect(result).toEqual({
      released: [2],
      refunded: [],
      refundedAmount: 0,
      cancelled: [3],
    });
    expect(events.record).toHaveBeenCalledWith(tx, {
      contractId: 20,
      actorId: 9,
      type: 'milestone_approved',
      data: { milestoneId: 32, position: 2, amount: 400, auto: false },
    });
  });

  it('SUBMITTED with REFUND (and with no choice): refund, milestone CANCELLED', async () => {
    for (const opts of [{ submittedChoice: 'REFUND' as const }, {}]) {
      const { tx, wallet, events, service } = setup();

      await service.end(tx as never, contract, 'FREELANCER_LATE', opts);

      expect(wallet.refund).toHaveBeenCalledTimes(1);
      expect(wallet.refund).toHaveBeenCalledWith(tx, move(32, 400));
      expect(wallet.release).not.toHaveBeenCalled();
      expect(statusUpdates(tx)).toEqual({ 32: M.CANCELLED, 33: M.CANCELLED });
      // No actor given: the sweeper did it.
      expect(events.record).toHaveBeenCalledWith(tx, {
        contractId: 20,
        actorId: null,
        type: 'milestone_refunded',
        data: { milestoneId: 32, position: 2, amount: 400 },
      });
    }
  });

  it('FUNDED and CHANGES_REQUESTED are refunded', async () => {
    const { tx, wallet, service } = setup();
    await service.end(
      tx as never,
      {
        ...contract,
        milestones: [
          { id: 41, position: 1, amount: 100, status: M.FUNDED },
          { id: 42, position: 2, amount: 200, status: M.CHANGES_REQUESTED },
        ],
      },
      'NOT_FUNDED',
      { submittedChoice: 'APPROVE' },
    );
    expect(wallet.refund.mock.calls.map(([, a]) => a)).toEqual([
      move(41, 100),
      move(42, 200),
    ]);
    expect(wallet.release).not.toHaveBeenCalled();
  });

  it('sets ENDED with reason and time, clears the end request, cancels an OPEN amendment, records contract_ended', async () => {
    const { tx, events, service } = setup();
    const now = new Date('2026-12-01T10:00:00Z');

    await service.end(tx as never, contract, 'CLIENT_ENDED', {
      actorId: 3,
      now,
    });

    expect(tx.amendment.updateMany).toHaveBeenCalledWith({
      where: { contractId: 20, status: AmendmentStatus.OPEN },
      data: { status: AmendmentStatus.CANCELLED, decidedAt: now },
    });
    expect(tx.contract.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: {
        status: ContractStatus.ENDED,
        endReason: 'CLIENT_ENDED',
        endedAt: now,
        endRequestedById: null,
        endRequestNote: null,
        endRequestChoice: null,
        endRequestMilestoneId: null,
        endRequestSubmissionId: null,
        endRequestedAt: null,
      },
    });
    expect(events.record).toHaveBeenLastCalledWith(tx, {
      contractId: 20,
      actorId: 3,
      type: 'contract_ended',
      data: { reason: 'CLIENT_ENDED' },
    });
  });
});

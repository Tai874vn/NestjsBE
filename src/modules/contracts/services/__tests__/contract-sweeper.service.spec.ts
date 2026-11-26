import { ContractStatus, MilestoneStatus, ProposalStatus } from '@prisma/client';
import { Role } from '../../../../common/constants/roles';
import { ContractEndingService } from '../contract-ending.service';
import { ContractStepService } from '../contract-step.service';
import {
  ContractSweeperService,
  fmtDuration,
} from '../contract-sweeper.service';
import { ContractsQueryService } from '../contracts-query.service';
import { ContractsService } from '../contracts.service';

const M = MilestoneStatus;
const C = ContractStatus;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const NOW = new Date('2026-12-01T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW.getTime() - ms);

function milestone(
  id: number,
  contractId: number,
  position: number,
  status: MilestoneStatus,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    contractId,
    position,
    title: `Part ${position}`,
    description: null,
    dueDate: new Date(NOW.getTime() + 10 * DAY),
    amount: 300 * position,
    status,
    fundedAt: null as Date | null,
    submittedAt: null as Date | null,
    changesRequestedAt: null as Date | null,
    approvedAt: null as Date | null,
    cancelledAt: null as Date | null,
    autoApproved: false,
    lateWarnedAt: null as Date | null,
    silentWarnedAt: null as Date | null,
    unfundedWarnedAt: null as Date | null,
    submissions: [] as unknown[],
    ...extra,
  };
}
type FakeMilestone = ReturnType<typeof milestone>;

function contractRow(id: number, milestones: FakeMilestone[]) {
  return {
    id,
    proposalId: id + 100,
    jobId: 4,
    clientId: 3,
    freelancerId: 9,
    title: `Contract ${id}`,
    brief: 'A logo',
    referenceLinks: [] as string[],
    referenceImages: [] as string[],
    deadline: new Date(NOW.getTime() + 20 * DAY),
    total: milestones.reduce((s, m) => s + m.amount, 0),
    status: C.ACTIVE as ContractStatus,
    endReason: null as string | null,
    imported: false,
    endRequestedById: null as number | null,
    endRequestNote: null as string | null,
    endRequestChoice: null as string | null,
    endRequestedAt: null as Date | null,
    completedAt: null as Date | null,
    endedAt: null as Date | null,
    createdAt: ago(20 * DAY),
    updatedAt: ago(DAY),
    job: { id: 4, title: 'Bakery logo', image: null, price: 1000 },
    client: { id: 3, name: 'Lan Tran', avatar: null },
    freelancer: { id: 9, name: 'Minh Le', avatar: null },
    milestones,
    amendments: [] as unknown[],
    review: null as unknown,
  };
}
type FakeContract = ReturnType<typeof contractRow>;

function proposalRow(id: number, expiresAt: Date) {
  return {
    id,
    jobId: 4,
    clientId: 3,
    freelancerId: 9,
    status: ProposalStatus.OPEN as ProposalStatus,
    latestVersion: 1,
    turnUserId: 9 as number | null,
    expiresAt,
    decidedAt: null as Date | null,
    job: { id: 4, title: 'Bakery logo' },
    client: { id: 3, name: 'Lan Tran' },
    freelancer: { id: 9, name: 'Minh Le' },
  };
}
type FakeProposal = ReturnType<typeof proposalRow>;

const SWEEP_STATUSES: MilestoneStatus[] = [
  M.FUNDED,
  M.SUBMITTED,
  M.CHANGES_REQUESTED,
  M.PENDING,
];

/**
 * A small in-memory database (like the one in contracts.service.spec.ts): each read gives a
 * copy, each update changes the saved rows. `onLock` runs when a contract row is locked, so a
 * test can let "another request" change the row first, like a real lock wait.
 */
function setup(
  contracts: FakeContract[],
  proposals: FakeProposal[] = [],
  grace = 4320,
) {
  const findContract = (id: number) => contracts.find((c) => c.id === id);
  const findMilestone = (id: number) =>
    contracts.flatMap((c) => c.milestones).find((m) => m.id === id);
  const hooks: { onLock?: (id: number) => Promise<void> } = {};
  const prisma = {
    $queryRaw: jest.fn(async (strings: string[], ...values: unknown[]) => {
      const sql = strings.join('?');
      if (/"contracts".*FOR UPDATE/.test(sql) && hooks.onLock) {
        const hook = hooks.onLock;
        hooks.onLock = undefined; // once
        await hook(values[0] as number);
      }
      return [];
    }),
    $transaction: jest.fn(),
    proposal: {
      findMany: jest.fn(
        ({
          where,
          take,
        }: {
          where: { expiresAt: { lt: Date }; id?: { gt: number } };
          take: number;
        }) =>
          Promise.resolve(
            proposals
              .filter(
                (p) =>
                  p.status === ProposalStatus.OPEN &&
                  p.expiresAt < where.expiresAt.lt &&
                  p.id > (where.id?.gt ?? 0),
              )
              .sort((a, b) => a.id - b.id)
              .slice(0, take)
              .map((p) => ({ id: p.id })),
          ),
      ),
      findUnique: jest.fn(({ where }: { where: { id: number } }) => {
        const p = proposals.find((x) => x.id === where.id);
        return Promise.resolve(p ? structuredClone(p) : null);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          Object.assign(proposals.find((x) => x.id === where.id)!, data);
          return Promise.resolve({});
        },
      ),
    },
    contract: {
      findMany: jest.fn(({ take }: { take: number }) =>
        Promise.resolve(
          contracts
            .filter(
              (c) =>
                c.status === C.ACTIVE &&
                c.milestones.some((m) => SWEEP_STATUSES.includes(m.status)),
            )
            .sort(
              (a, b) =>
                a.updatedAt.getTime() - b.updatedAt.getTime() || a.id - b.id,
            )
            .slice(0, take)
            .map((c) => ({ id: c.id, updatedAt: c.updatedAt })),
        ),
      ),
      findUnique: jest.fn(({ where }: { where: { id: number } }) => {
        const c = findContract(where.id);
        return Promise.resolve(c ? structuredClone(c) : null);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          Object.assign(findContract(where.id)!, data);
          return Promise.resolve({});
        },
      ),
    },
    milestone: {
      findUnique: jest.fn(({ where }: { where: { id: number } }) => {
        const m = findMilestone(where.id);
        return Promise.resolve(m ? { contractId: m.contractId } : null);
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          Object.assign(findMilestone(where.id)!, data);
          return Promise.resolve({});
        },
      ),
    },
    amendment: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    contractEvent: { findMany: jest.fn().mockResolvedValue([]) },
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  const wallet = {
    hold: jest.fn().mockResolvedValue(undefined),
    release: jest.fn().mockResolvedValue(undefined),
    refund: jest.fn().mockResolvedValue(undefined),
  };
  const events = {
    record: jest.fn().mockResolvedValue(undefined),
    announce: jest.fn().mockResolvedValue(undefined),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'CONTRACT_GRACE_MINUTES' ? grace : undefined,
    ),
  };
  const redis = {
    invalidateUserProfile: jest.fn().mockResolvedValue(undefined),
  };
  const query = new ContractsQueryService(prisma as never);
  const step = new ContractStepService(prisma as never, events as never, query);
  const ending = new ContractEndingService(wallet as never, events as never);
  const contractsService = new ContractsService(
    step,
    wallet as never,
    events as never,
    ending,
    redis as never,
  );
  const sweeper = new ContractSweeperService(
    prisma as never,
    step,
    events as never,
    ending,
    config as never,
    redis as never,
  );
  return {
    prisma,
    wallet,
    events,
    redis,
    sweeper,
    contractsService,
    hooks,
    contracts,
    proposals,
  };
}

const recorded = (events: { record: jest.Mock }, type: string) =>
  events.record.mock.calls.filter(
    ([, e]: [unknown, { type: string }]) => e.type === type,
  );

describe('ContractSweeperService', () => {
  describe('proposal expiry', () => {
    it('expires an OPEN proposal 8 days old once and tells both sides', async () => {
      const p = proposalRow(70, ago(DAY)); // last version 8 days ago → expired 1 day ago
      const fresh = proposalRow(71, new Date(NOW.getTime() + DAY));
      const { sweeper, events, prisma, proposals } = setup([], [p, fresh]);

      const first = await sweeper.sweepOnce(NOW);

      expect(first.expired).toBe(1);
      expect(proposals[0]).toMatchObject({
        status: ProposalStatus.EXPIRED,
        turnUserId: null,
        decidedAt: NOW,
      });
      expect(proposals[1].status).toBe(ProposalStatus.OPEN);
      const locks = prisma.$queryRaw.mock.calls.map(
        ([s, ...v]: [string[], ...unknown[]]) => ({ sql: s.join('?'), v }),
      );
      expect(locks).toContainEqual({
        sql: expect.stringMatching(/"proposals".*FOR UPDATE/),
        v: [70],
      });
      expect(recorded(events, 'proposal_expired')).toEqual([
        [prisma, { proposalId: 70, actorId: null, type: 'proposal_expired' }],
      ]);
      expect(events.announce).toHaveBeenCalledTimes(2);
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 3,
          recipientSide: 'client',
          kind: 'proposal',
          step: 'proposal_expired',
          proposalId: 70,
          actorId: null,
        }),
      );
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 9, recipientSide: 'freelancer' }),
      );

      const second = await sweeper.sweepOnce(NOW);
      expect(second.expired).toBe(0);
      expect(recorded(events, 'proposal_expired')).toHaveLength(1);
    });

    it('does not expire a proposal that got a new version while it waited for the lock', async () => {
      const p = proposalRow(72, ago(MINUTE));
      const { sweeper, prisma, events, proposals } = setup([], [p]);
      // The other side answered (a new version moves expiresAt) just before the lock.
      prisma.proposal.findUnique.mockImplementationOnce(() =>
        Promise.resolve({
          ...structuredClone(proposals[0]),
          expiresAt: new Date(NOW.getTime() + 7 * DAY),
        }),
      );

      const result = await sweeper.sweepOnce(NOW);

      expect(result.expired).toBe(0);
      expect(proposals[0].status).toBe(ProposalStatus.OPEN);
      expect(events.announce).not.toHaveBeenCalled();
    });
  });

  describe('client silent', () => {
    it('approves a milestone SUBMITTED 3 days ago automatically and COMPLETES the contract when it was the last', async () => {
      const c = contractRow(20, [
        milestone(31, 20, 1, M.APPROVED, { approvedAt: ago(5 * DAY) }),
        milestone(32, 20, 2, M.SUBMITTED, {
          fundedAt: ago(5 * DAY),
          submittedAt: ago(3 * DAY + MINUTE),
        }),
      ]);
      const { sweeper, wallet, events, redis, prisma, contracts } = setup([c]);

      const first = await sweeper.sweepOnce(NOW);

      expect(first).toEqual({ expired: 0, warned: 0, ended: 0, completed: 1 });
      expect(redis.invalidateUserProfile).toHaveBeenCalledWith(9);
      expect(wallet.release).toHaveBeenCalledTimes(1);
      expect(wallet.release).toHaveBeenCalledWith(prisma, {
        clientId: 3,
        freelancerId: 9,
        amount: 600,
        contractId: 20,
        milestoneId: 32,
      });
      expect(wallet.refund).not.toHaveBeenCalled();
      expect(contracts[0].milestones[1]).toMatchObject({
        status: M.APPROVED,
        approvedAt: NOW,
        autoApproved: true,
      });
      expect(contracts[0]).toMatchObject({
        status: C.COMPLETED,
        completedAt: NOW,
      });
      expect(recorded(events, 'milestone_approved')[0][1]).toEqual({
        contractId: 20,
        actorId: null,
        type: 'milestone_approved',
        data: { milestoneId: 32, position: 2, amount: 600, auto: true },
      });
      expect(recorded(events, 'contract_completed')).toHaveLength(1);
      // Both sides are told; one chat line, sent as the client, starting with "JobAura:".
      expect(events.announce).toHaveBeenCalledTimes(2);
      const chats = events.announce.mock.calls
        .map(([a]: [{ chat?: { fromId: number; text: string } }]) => a.chat)
        .filter(Boolean);
      expect(chats).toHaveLength(1);
      expect(chats[0]).toMatchObject({ fromId: 3, toId: 9 });
      expect(chats[0]!.text).toMatch(/^JobAura: /);

      // Same input again: nothing more happens.
      const second = await sweeper.sweepOnce(NOW);
      expect(second).toEqual({ expired: 0, warned: 0, ended: 0, completed: 0 });
      expect(wallet.release).toHaveBeenCalledTimes(1);
    });

    it('approves automatically, then ENDS the contract when milestones are left (CLIENT_SILENT)', async () => {
      const c = contractRow(20, [
        milestone(31, 20, 1, M.SUBMITTED, {
          fundedAt: ago(5 * DAY),
          submittedAt: ago(3 * DAY),
        }),
        milestone(32, 20, 2, M.PENDING),
      ]);
      const { sweeper, wallet, events, contracts } = setup([c]);

      const result = await sweeper.sweepOnce(NOW);

      expect(result).toEqual({ expired: 0, warned: 0, ended: 1, completed: 0 });
      expect(wallet.release).toHaveBeenCalledTimes(1);
      expect(wallet.refund).not.toHaveBeenCalled();
      expect(contracts[0].milestones[0]).toMatchObject({
        status: M.APPROVED,
        autoApproved: true,
      });
      expect(contracts[0].milestones[1].status).toBe(M.CANCELLED);
      expect(contracts[0]).toMatchObject({
        status: C.ENDED,
        endReason: 'CLIENT_SILENT',
        endedAt: NOW,
      });
      expect(recorded(events, 'contract_ended')[0][1]).toMatchObject({
        actorId: null,
        data: { reason: 'CLIENT_SILENT' },
      });
    });

    it('with CONTRACT_GRACE_MINUTES=10, approves a milestone SUBMITTED 11 minutes ago', async () => {
      const c = contractRow(20, [
        milestone(31, 20, 1, M.SUBMITTED, {
          fundedAt: ago(DAY),
          submittedAt: ago(11 * MINUTE),
        }),
      ]);
      const { sweeper, wallet, contracts } = setup([c], [], 10);

      const result = await sweeper.sweepOnce(NOW);

      expect(result.completed).toBe(1);
      expect(wallet.release).toHaveBeenCalledTimes(1);
      expect(contracts[0].milestones[0]).toMatchObject({
        status: M.APPROVED,
        autoApproved: true,
      });
    });

    it('a client who approved while the sweeper waited for the lock wins: the sweeper re-reads, sees APPROVED and does nothing (one RELEASE)', async () => {
      const c = contractRow(20, [
        milestone(31, 20, 1, M.SUBMITTED, {
          fundedAt: ago(5 * DAY),
          submittedAt: ago(3 * DAY + MINUTE),
        }),
      ]);
      const { sweeper, wallet, events, contractsService, hooks, contracts } =
        setup([c]);
      // The candidate list said SUBMITTED; the client's Approve commits before our lock.
      hooks.onLock = async () => {
        await contractsService.approve(31, { id: 3, role: Role.USER });
      };

      const result = await sweeper.sweepOnce(NOW);

      expect(result).toEqual({ expired: 0, warned: 0, ended: 0, completed: 0 });
      expect(wallet.release).toHaveBeenCalledTimes(1);
      expect(contracts[0].milestones[0]).toMatchObject({
        status: M.APPROVED,
        autoApproved: false,
      });
      expect(contracts[0].status).toBe(C.COMPLETED);
      const approvals = recorded(events, 'milestone_approved');
      expect(approvals).toHaveLength(1);
      expect(approvals[0][1]).toMatchObject({ actorId: 3 });
    });

    it('warns the client once at two thirds of the window', async () => {
      const c = contractRow(20, [
        milestone(31, 20, 1, M.SUBMITTED, {
          fundedAt: ago(5 * DAY),
          submittedAt: ago(2 * DAY + MINUTE),
        }),
      ]);
      const { sweeper, events, contracts } = setup([c]);

      const first = await sweeper.sweepOnce(NOW);
      expect(first.warned).toBe(1);
      expect(contracts[0].milestones[0].silentWarnedAt).toEqual(NOW);
      expect(recorded(events, 'warning_sent')[0][1]).toEqual({
        contractId: 20,
        actorId: null,
        type: 'warning_sent',
        data: { rule: 'CLIENT_SILENT', milestoneId: 31, position: 1 },
      });
      expect(events.announce).toHaveBeenCalledTimes(1);
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 3,
          recipientSide: 'client',
          step: 'warning_sent',
          jobTitle: 'Bakery logo',
          position: 1,
          rule: 'client_silent',
        }),
      );

      const second = await sweeper.sweepOnce(NOW);
      expect(second.warned).toBe(0);
      expect(events.announce).toHaveBeenCalledTimes(1);
    });
  });

  describe('freelancer late', () => {
    it('warns both sides once when the due date has passed', async () => {
      const c = contractRow(20, [
        milestone(31, 20, 1, M.FUNDED, {
          fundedAt: ago(10 * DAY),
          dueDate: ago(MINUTE),
        }),
      ]);
      const { sweeper, events, contracts } = setup([c]);

      const first = await sweeper.sweepOnce(NOW);

      expect(first.warned).toBe(1);
      expect(contracts[0].milestones[0].lateWarnedAt).toEqual(NOW);
      expect(events.announce).toHaveBeenCalledTimes(2);
      for (const id of [3, 9]) {
        expect(events.announce).toHaveBeenCalledWith(
          expect.objectContaining({
            recipientId: id,
            body: 'Milestone 1 is past its due date. 3 days left to submit.',
          }),
        );
      }
      expect((await sweeper.sweepOnce(NOW)).warned).toBe(0);
    });

    it('ENDS the contract 3 days after the due date: the held credits go back to the client', async () => {
      const c = contractRow(20, [
        milestone(31, 20, 1, M.FUNDED, {
          fundedAt: ago(10 * DAY),
          dueDate: ago(3 * DAY),
          lateWarnedAt: ago(3 * DAY),
        }),
        milestone(32, 20, 2, M.PENDING),
      ]);
      const { sweeper, wallet, contracts } = setup([c]);

      const result = await sweeper.sweepOnce(NOW);

      expect(result.ended).toBe(1);
      expect(wallet.refund).toHaveBeenCalledTimes(1);
      expect(wallet.release).not.toHaveBeenCalled();
      expect(contracts[0]).toMatchObject({
        status: C.ENDED,
        endReason: 'FREELANCER_LATE',
      });
      expect(contracts[0].milestones.map((m) => m.status)).toEqual([
        M.CANCELLED,
        M.CANCELLED,
      ]);
    });
  });

  describe('not funded', () => {
    it('ENDS the contract when the next milestone stays unfunded 3 days after the approval', async () => {
      const c = contractRow(20, [
        milestone(31, 20, 1, M.APPROVED, { approvedAt: ago(3 * DAY) }),
        milestone(32, 20, 2, M.PENDING),
      ]);
      const { sweeper, contracts, wallet } = setup([c]);

      const result = await sweeper.sweepOnce(NOW);

      expect(result.ended).toBe(1);
      expect(wallet.refund).not.toHaveBeenCalled();
      expect(contracts[0]).toMatchObject({
        status: C.ENDED,
        endReason: 'NOT_FUNDED',
      });
      expect(contracts[0].milestones[0].status).toBe(M.APPROVED);
      expect(contracts[0].milestones[1].status).toBe(M.CANCELLED);
    });

    it('leaves imported contracts alone', async () => {
      const c = contractRow(20, [milestone(31, 20, 1, M.PENDING)]);
      c.imported = true;
      const { sweeper, contracts } = setup([c]);

      const result = await sweeper.sweepOnce(NOW);

      expect(result).toEqual({ expired: 0, warned: 0, ended: 0, completed: 0 });
      expect(contracts[0].status).toBe(C.ACTIVE);
    });
  });

  it('one contract failing does not stop the next', async () => {
    const broken = contractRow(20, [
      milestone(31, 20, 1, M.SUBMITTED, {
        fundedAt: ago(5 * DAY),
        submittedAt: ago(3 * DAY),
      }),
    ]);
    const good = contractRow(21, [
      milestone(41, 21, 1, M.SUBMITTED, {
        fundedAt: ago(5 * DAY),
        submittedAt: ago(3 * DAY),
      }),
    ]);
    good.updatedAt = ago(DAY - MINUTE); // after the broken one
    const { sweeper, wallet, contracts } = setup([broken, good]);
    wallet.release.mockRejectedValueOnce(new Error('wallet is broken'));

    const result = await sweeper.sweepOnce(NOW);

    expect(result.completed).toBe(1);
    expect(contracts[1].status).toBe(C.COMPLETED);
  });

  it('skips a pass while another pass is still running', async () => {
    const { sweeper, prisma } = setup([]);
    let release!: () => void;
    prisma.proposal.findMany.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve([]);
        }),
    );

    const slow = sweeper.sweepOnce(NOW);
    const skipped = await sweeper.sweepOnce(NOW);
    release();
    await slow;

    expect(skipped).toEqual({ expired: 0, warned: 0, ended: 0, completed: 0 });
    expect(prisma.proposal.findMany).toHaveBeenCalledTimes(1);
  });
});

describe('fmtDuration', () => {
  it.each([
    [3 * DAY, '3 days'],
    [3 * DAY - MINUTE, '3 days'],
    [DAY, '1 day'],
    [5 * 60 * MINUTE, '5 hours'],
    [10 * MINUTE, '10 minutes'],
    [30_000, '1 minute'],
  ])('%d ms → %s', (ms, text) => {
    expect(fmtDuration(ms)).toBe(text);
  });
});

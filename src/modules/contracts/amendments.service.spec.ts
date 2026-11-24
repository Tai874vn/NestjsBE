import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  AmendmentStatus,
  ContractStatus,
  MilestoneStatus,
  Prisma,
} from '@prisma/client';
import { Role } from '../../common/constants/roles';
import { AmendmentsService } from './amendments.service';
import { ContractEndingService } from './contract-ending.service';
import { ContractStepService } from './contract-step.service';
import { ContractsQueryService } from './contracts-query.service';
import { CreateAmendmentDto } from './dto/amendment.dto';

const M = MilestoneStatus;
const C = ContractStatus;
const A = AmendmentStatus;
const DAY = 24 * 60 * 60 * 1000;
const client = { id: 3, role: Role.USER };
const freelancer = { id: 9, role: Role.USER };
const stranger = { id: 50, role: Role.USER };
const inDays = (n: number) => new Date(Date.now() + n * DAY);

function milestone(
  id: number,
  position: number,
  status: MilestoneStatus,
  amount: number,
) {
  return {
    id,
    contractId: 20,
    position,
    title: `Part ${position}`,
    description: null as string | null,
    dueDate: inDays(position),
    amount,
    status,
    fundedAt: null as Date | null,
    submittedAt: null as Date | null,
    changesRequestedAt: null as Date | null,
    approvedAt: null as Date | null,
    cancelledAt: null as Date | null,
    autoApproved: false,
    lateWarnedAt: new Date() as Date | null,
    silentWarnedAt: new Date() as Date | null,
    unfundedWarnedAt: new Date() as Date | null,
    submissions: [] as unknown[],
  };
}
type FakeMilestone = ReturnType<typeof milestone>;

type FakeAmendment = {
  id: number;
  contractId: number;
  proposerId: number;
  status: AmendmentStatus;
  note: string | null;
  deadline: Date | null;
  changes: unknown;
  declineNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

/** A small in-memory database (see contracts.service.spec.ts): reads give copies. */
function setup(milestones: FakeMilestone[], status: ContractStatus = C.ACTIVE) {
  const state = {
    id: 20,
    proposalId: 5,
    jobId: 4,
    clientId: 3,
    freelancerId: 9,
    title: 'Bakery logo',
    brief: 'A logo',
    referenceLinks: [] as string[],
    referenceImages: [] as string[],
    deadline: inDays(10),
    total: milestones.reduce((s, m) => s + m.amount, 0),
    status,
    endReason: null as string | null,
    imported: false,
    endRequestedById: null as number | null,
    endRequestNote: null as string | null,
    endRequestChoice: null as string | null,
    endRequestedAt: null as Date | null,
    completedAt: null as Date | null,
    endedAt: null as Date | null,
    createdAt: new Date(),
    updatedAt: new Date(),
    job: { id: 4, title: 'Bakery logo', image: null, price: 1000 },
    client: { id: 3, name: 'Lan Tran', avatar: null },
    freelancer: { id: 9, name: 'Minh Le', avatar: null },
    milestones,
    amendments: [] as FakeAmendment[],
    review: null as unknown,
  };
  const find = (id: number) => state.milestones.find((m) => m.id === id)!;
  let nextMilestoneId = 900;
  let nextAmendmentId = 70;
  const prisma = {
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn(),
    contract: {
      findUnique: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(where.id === state.id ? structuredClone(state) : null),
      ),
      update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state, data);
        return Promise.resolve({});
      }),
    },
    milestone: {
      create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
        state.milestones.push({
          ...milestone(nextMilestoneId++, 0, M.PENDING, 1),
          lateWarnedAt: null,
          silentWarnedAt: null,
          unfundedWarnedAt: null,
          ...data,
        } as FakeMilestone);
        return Promise.resolve({});
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          Object.assign(find(where.id), data);
          return Promise.resolve({});
        },
      ),
    },
    amendment: {
      findUnique: jest.fn(({ where }: { where: { id: number } }) => {
        const a = state.amendments.find((x) => x.id === where.id);
        return Promise.resolve(a ? structuredClone(a) : null);
      }),
      findFirst: jest.fn(() => {
        const a = state.amendments.find((x) => x.status === A.OPEN);
        return Promise.resolve(a ? { id: a.id } : null);
      }),
      create: jest.fn(({ data }: { data: Partial<FakeAmendment> }) => {
        const row = {
          status: A.OPEN,
          declineNote: null,
          decidedAt: null,
          ...data,
          id: nextAmendmentId++,
        } as FakeAmendment;
        state.amendments.push(row);
        return Promise.resolve({ id: row.id });
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Partial<FakeAmendment>;
        }) => {
          Object.assign(
            state.amendments.find((x) => x.id === where.id)!,
            data,
          );
          return Promise.resolve({});
        },
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
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
  const query = new ContractsQueryService(prisma as never);
  const step = new ContractStepService(prisma as never, events as never, query);
  const ending = new ContractEndingService(wallet as never, events as never);
  const service = new AmendmentsService(
    prisma as never,
    step,
    events as never,
    ending,
  );
  return { prisma, wallet, events, service, state };
}

function body(
  changes: CreateAmendmentDto['changes'],
  extra: Partial<CreateAmendmentDto> = {},
): CreateAmendmentDto {
  return { changes, ...extra };
}

describe('AmendmentsService', () => {
  describe('propose', () => {
    it('saves an OPEN amendment, locks the contract, records the step and tells the other side', async () => {
      const { prisma, events, service, state } = setup([
        milestone(31, 1, M.FUNDED, 300),
      ]);

      const result = await service.propose(
        20,
        freelancer,
        body(
          [{ op: 'move', milestoneId: 31, dueDate: inDays(5).toISOString() }],
          { note: ' more time ' },
        ),
      );

      expect(prisma.$queryRaw).toHaveBeenCalled();
      expect(state.amendments).toHaveLength(1);
      expect(state.amendments[0]).toMatchObject({
        status: A.OPEN,
        proposerId: 9,
        note: 'more time',
        deadline: null,
      });
      expect(events.record).toHaveBeenCalledWith(prisma, {
        contractId: 20,
        actorId: 9,
        type: 'amendment_proposed',
        data: { amendmentId: 70 },
      });
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 3,
          step: 'amendment_proposed',
          recipientSide: 'client',
        }),
      );
      expect(result.message).toBe('Change request sent');
      expect(result.content.id).toBe(20);
    });

    it('an amount change on a FUNDED milestone is 409 and nothing is saved', async () => {
      const { events, service, state } = setup([
        milestone(31, 1, M.FUNDED, 300),
      ]);

      await expect(
        service.propose(
          20,
          client,
          body([{ op: 'amount', milestoneId: 31, amount: 100 }]),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(state.amendments).toHaveLength(0);
      expect(events.announce).not.toHaveBeenCalled();
    });

    it('a SUBMITTED milestone cannot be changed: 409 "Milestone 1 cannot be changed now."', async () => {
      const { service } = setup([milestone(31, 1, M.SUBMITTED, 300)]);

      await expect(
        service.propose(
          20,
          client,
          body([
            { op: 'move', milestoneId: 31, dueDate: inDays(5).toISOString() },
          ]),
        ),
      ).rejects.toThrow(
        new ConflictException('Milestone 1 cannot be changed now.'),
      );
    });

    it('empty changes with no deadline is 400', async () => {
      const { service } = setup([milestone(31, 1, M.FUNDED, 300)]);

      await expect(service.propose(20, client, body([]))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('a second open amendment is 409 "This contract already has an open change request."', async () => {
      const { service, state } = setup([milestone(31, 1, M.PENDING, 300)]);
      const change = body([{ op: 'amount', milestoneId: 31, amount: 200 }]);

      await service.propose(20, client, change);
      await expect(service.propose(20, freelancer, change)).rejects.toThrow(
        new ConflictException(
          'This contract already has an open change request.',
        ),
      );
      expect(state.amendments).toHaveLength(1);
    });

    it('the partial unique index (P2002) also gives that 409', async () => {
      const { prisma, service } = setup([milestone(31, 1, M.PENDING, 300)]);
      prisma.amendment.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      await expect(
        service.propose(
          20,
          client,
          body([{ op: 'amount', milestoneId: 31, amount: 200 }]),
        ),
      ).rejects.toThrow(
        'This contract already has an open change request.',
      );
    });

    it('a stranger gets 403 and a completed or ended contract gives 409', async () => {
      const change = body([{ op: 'amount', milestoneId: 31, amount: 200 }]);
      const { service } = setup([milestone(31, 1, M.PENDING, 300)]);
      await expect(service.propose(20, stranger, change)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      for (const status of [C.COMPLETED, C.ENDED]) {
        const s = setup([milestone(31, 1, M.PENDING, 300)], status);
        await expect(s.service.propose(20, client, change)).rejects.toBeInstanceOf(
          ConflictException,
        );
      }
    });
  });

  describe('accept', () => {
    it('moving a FUNDED due date later is applied and clears that milestone warning flags only', async () => {
      const { service, state } = setup([
        milestone(31, 1, M.FUNDED, 300),
        milestone(32, 2, M.PENDING, 700),
      ]);
      state.milestones[1].dueDate = inDays(8);
      const newDue = inDays(6);
      await service.propose(
        20,
        freelancer,
        body([{ op: 'move', milestoneId: 31, dueDate: newDue.toISOString() }]),
      );

      const result = await service.accept(70, client);

      expect(state.milestones[0].dueDate).toEqual(newDue);
      expect(state.milestones[0]).toMatchObject({
        lateWarnedAt: null,
        silentWarnedAt: null,
        unfundedWarnedAt: null,
      });
      expect(state.milestones[1].lateWarnedAt).toBeInstanceOf(Date);
      expect(state.amendments[0].status).toBe(A.ACCEPTED);
      expect(state.total).toBe(1000);
      expect(result.message).toBe('Change request accepted');
    });

    it('adding a milestone appends position n+1, grows the total and can move the deadline', async () => {
      const { service, state } = setup([
        milestone(31, 1, M.FUNDED, 300),
        milestone(32, 2, M.PENDING, 700),
      ]);
      const deadline = inDays(30);
      await service.propose(
        20,
        client,
        body(
          [
            {
              op: 'add',
              title: 'Extra',
              description: 'More',
              dueDate: inDays(12).toISOString(),
              amount: 150,
            },
          ],
          { deadline: deadline.toISOString() },
        ),
      );

      await service.accept(70, freelancer);

      expect(state.milestones).toHaveLength(3);
      expect(state.milestones[2]).toMatchObject({
        position: 3,
        title: 'Extra',
        amount: 150,
        status: M.PENDING,
        contractId: 20,
      });
      expect(state.total).toBe(1150);
      expect(state.deadline).toEqual(deadline);
    });

    it('an amount change on a PENDING milestone updates the total', async () => {
      const { service, state } = setup([
        milestone(31, 1, M.PENDING, 300),
        milestone(32, 2, M.PENDING, 700),
      ]);
      await service.propose(
        20,
        client,
        body([{ op: 'amount', milestoneId: 32, amount: 400 }]),
      );

      await service.accept(70, freelancer);

      expect(state.milestones[1].amount).toBe(400);
      expect(state.total).toBe(700);
    });

    it('the proposer cannot accept (403) and nothing changes', async () => {
      const { service, state } = setup([milestone(31, 1, M.PENDING, 300)]);
      await service.propose(
        20,
        client,
        body([{ op: 'amount', milestoneId: 31, amount: 100 }]),
      );

      await expect(service.accept(70, client)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(state.amendments[0].status).toBe(A.OPEN);
      expect(state.milestones[0].amount).toBe(300);
    });

    it('is checked again: a milestone funded since then gives 409 and nothing is applied', async () => {
      const { service, state } = setup([milestone(31, 1, M.PENDING, 300)]);
      await service.propose(
        20,
        client,
        body([{ op: 'amount', milestoneId: 31, amount: 100 }]),
      );
      state.milestones[0].status = M.FUNDED;

      await expect(service.accept(70, freelancer)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(state.milestones[0].amount).toBe(300);
      expect(state.amendments[0].status).toBe(A.OPEN);
    });

    it('a second accept gets 409 (already accepted)', async () => {
      const { service } = setup([milestone(31, 1, M.PENDING, 300)]);
      await service.propose(
        20,
        client,
        body([{ op: 'amount', milestoneId: 31, amount: 100 }]),
      );
      await service.accept(70, freelancer);

      await expect(service.accept(70, freelancer)).rejects.toThrow(
        new ConflictException('This change request was already accepted.'),
      );
    });
  });

  describe('decline and withdraw', () => {
    it('the other side declines with a note; the proposer cannot', async () => {
      const { service, state } = setup([milestone(31, 1, M.PENDING, 300)]);
      await service.propose(
        20,
        client,
        body([{ op: 'amount', milestoneId: 31, amount: 100 }]),
      );

      await expect(
        service.decline(70, client, 'no'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await service.decline(70, freelancer, ' too low ');

      expect(state.amendments[0]).toMatchObject({
        status: A.DECLINED,
        declineNote: 'too low',
      });
      expect(state.milestones[0].amount).toBe(300);
    });

    it('only the proposer withdraws, and then a new request is allowed', async () => {
      const { service, state } = setup([milestone(31, 1, M.PENDING, 300)]);
      const change = body([{ op: 'amount', milestoneId: 31, amount: 100 }]);
      await service.propose(20, client, change);

      await expect(service.withdraw(70, freelancer)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await service.withdraw(70, client);
      expect(state.amendments[0].status).toBe(A.WITHDRAWN);
      await service.propose(20, freelancer, change);
      expect(state.amendments).toHaveLength(2);
    });
  });

  describe('mutual end', () => {
    it('the freelancer asks, the client accepts with a SUBMITTED milestone and no choice: 400, nothing ends', async () => {
      const { wallet, service, state } = setup([
        milestone(31, 1, M.SUBMITTED, 300),
      ]);
      await service.requestEnd(20, freelancer, {});
      expect(state.endRequestedById).toBe(9);

      await expect(service.acceptEnd(20, client, {})).rejects.toThrow(
        new BadRequestException(
          'Choose approve or refund for the submitted work.',
        ),
      );
      expect(state.status).toBe(C.ACTIVE);
      expect(wallet.release).not.toHaveBeenCalled();
    });

    it('with APPROVE the contract is ENDED (MUTUAL) and the submitted milestone is released', async () => {
      const { wallet, events, prisma, service, state } = setup([
        milestone(31, 1, M.SUBMITTED, 300),
        milestone(32, 2, M.PENDING, 700),
      ]);
      await service.requestEnd(20, freelancer, { note: 'sorry' });

      const result = await service.acceptEnd(20, client, {
        submittedChoice: 'APPROVE',
      });

      expect(wallet.release).toHaveBeenCalledTimes(1);
      expect(wallet.refund).not.toHaveBeenCalled();
      expect(state.milestones[0].status).toBe(M.APPROVED);
      expect(state.milestones[1].status).toBe(M.CANCELLED);
      expect(state.status).toBe(C.ENDED);
      expect(state.endReason).toBe('MUTUAL');
      expect(state.endRequestedById).toBeNull();
      expect(events.record).toHaveBeenCalledWith(prisma, {
        contractId: 20,
        actorId: 3,
        type: 'contract_ended',
        data: { reason: 'MUTUAL' },
      });
      expect(result.content.status).toBe(C.ENDED);
    });

    it('with REFUND (client request) the held credits go back and the freelancer can accept', async () => {
      const { wallet, service, state } = setup([
        milestone(31, 1, M.SUBMITTED, 300),
      ]);
      await service.requestEnd(20, client, { submittedChoice: 'REFUND' });
      expect(state.endRequestChoice).toBe('REFUND');

      await service.acceptEnd(20, freelancer, {});

      expect(wallet.refund).toHaveBeenCalledTimes(1);
      expect(state.status).toBe(C.ENDED);
    });

    it('the client must pick when asking with a SUBMITTED milestone (400)', async () => {
      const { service, state } = setup([milestone(31, 1, M.SUBMITTED, 300)]);

      await expect(service.requestEnd(20, client, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(state.endRequestedById).toBeNull();
    });

    it('with nothing submitted no choice is needed', async () => {
      const { service, state } = setup([milestone(31, 1, M.FUNDED, 300)]);
      await service.requestEnd(20, client, { submittedChoice: 'APPROVE' });
      expect(state.endRequestChoice).toBeNull();

      await service.acceptEnd(20, freelancer, {});

      expect(state.status).toBe(C.ENDED);
    });

    it('one end request at a time (409), the asker cannot accept or decline (403), only the asker withdraws', async () => {
      const { service, state } = setup([milestone(31, 1, M.FUNDED, 300)]);
      await service.requestEnd(20, freelancer, {});

      await expect(
        service.requestEnd(20, client, {}),
      ).rejects.toThrow(new ConflictException('An end request is already open.'));
      await expect(service.acceptEnd(20, freelancer, {})).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.declineEnd(20, freelancer)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(service.withdrawEnd(20, client)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await service.withdrawEnd(20, freelancer);
      expect(state.endRequestedById).toBeNull();
    });

    it('decline clears the request and the contract goes on', async () => {
      const { service, state } = setup([milestone(31, 1, M.FUNDED, 300)]);
      await service.requestEnd(20, freelancer, {});

      await service.declineEnd(20, client);

      expect(state.endRequestedById).toBeNull();
      expect(state.status).toBe(C.ACTIVE);
      await expect(service.declineEnd(20, client)).rejects.toThrow(
        new ConflictException('There is no open end request.'),
      );
    });

    it('an end request on a COMPLETED contract is 409', async () => {
      const { service } = setup([milestone(31, 1, M.APPROVED, 300)], C.COMPLETED);

      await expect(service.requestEnd(20, client, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('stopping the contract closes an open amendment (via the ending service)', async () => {
      const { prisma, service } = setup([milestone(31, 1, M.FUNDED, 300)]);
      await service.requestEnd(20, freelancer, {});

      await service.acceptEnd(20, client, {});

      expect(prisma.amendment.updateMany).toHaveBeenCalledWith({
        where: { contractId: 20, status: A.OPEN },
        data: { status: A.CANCELLED, decidedAt: expect.any(Date) as Date },
      });
    });
  });
});

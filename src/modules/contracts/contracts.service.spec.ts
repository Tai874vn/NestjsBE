import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { ContractStatus, MilestoneStatus } from '@prisma/client';
import { Role } from '../../common/constants/roles';
import { InsufficientCreditsError } from '../wallet/wallet.service';
import { AmendmentsService } from './amendments.service';
import { ContractEndingService } from './contract-ending.service';
import { ContractStepService } from './contract-step.service';
import { ContractsQueryService } from './contracts-query.service';
import { ContractsService } from './contracts.service';

const M = MilestoneStatus;
const C = ContractStatus;
const DAY = 24 * 60 * 60 * 1000;
const client = { id: 3, role: Role.USER };
const freelancer = { id: 9, role: Role.USER };
const stranger = { id: 50, role: Role.USER };
const CLOUD = 'jobaura-test';
const image = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/contracts/a.png`;

type FakeSubmission = {
  id: number;
  milestoneId: number;
  number: number;
  authorId: number;
  note: string;
  images: string[];
  links: string[];
  feedback: string | null;
  createdAt: Date;
};

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
    description: null,
    dueDate: new Date(Date.now() + position * DAY),
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
    submissions: [] as FakeSubmission[],
  };
}
type FakeMilestone = ReturnType<typeof milestone>;

function contractRow(milestones: FakeMilestone[], status: ContractStatus) {
  return {
    id: 20,
    proposalId: 5,
    jobId: 4,
    clientId: 3,
    freelancerId: 9,
    title: 'Bakery logo',
    brief: 'A logo',
    referenceLinks: [] as string[],
    referenceImages: [] as string[],
    deadline: new Date(Date.now() + 10 * DAY),
    total: milestones.reduce((s, m) => s + m.amount, 0),
    status,
    endReason: null as string | null,
    imported: false,
    endRequestedById: null as number | null,
    endRequestNote: null as string | null,
    endRequestChoice: null as string | null,
    endRequestMilestoneId: null as number | null,
    endRequestSubmissionId: null as number | null,
    endRequestedAt: null as Date | null,
    completedAt: null as Date | null,
    endedAt: null as Date | null,
    createdAt: new Date(),
    updatedAt: new Date(),
    job: { id: 4, title: 'Bakery logo', image: null, price: 1000 },
    client: { id: 3, name: 'Lan Tran', avatar: null },
    freelancer: { id: 9, name: 'Minh Le', avatar: null },
    milestones,
    amendments: [] as unknown[],
    review: null as unknown,
  };
}

/**
 * A small in-memory database: each read gives a copy (like a real read), each update changes
 * the saved rows. So two actions in a row see each other's changes, as they would after the lock.
 */
function setup(milestones: FakeMilestone[], status: ContractStatus = C.ACTIVE) {
  const state = contractRow(milestones, status);
  const find = (id: number) => state.milestones.find((m) => m.id === id);
  let nextSubmissionId = 600;
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
      findUnique: jest.fn(({ where }: { where: { id: number } }) =>
        Promise.resolve(find(where.id) ? { contractId: state.id } : null),
      ),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Record<string, unknown>;
        }) => {
          Object.assign(find(where.id)!, data);
          return Promise.resolve({});
        },
      ),
    },
    submission: {
      findFirst: jest.fn(({ where }: { where: { milestoneId: number } }) => {
        const list = find(where.milestoneId)!.submissions;
        return Promise.resolve(list.length ? list[0] : null);
      }),
      create: jest.fn(({ data }: { data: Omit<FakeSubmission, 'id'> }) => {
        // Newest first, like the real read.
        find(data.milestoneId)!.submissions.unshift({
          feedback: null,
          ...data,
          id: nextSubmissionId++,
        });
        return Promise.resolve({});
      }),
      update: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: number };
          data: Partial<FakeSubmission>;
        }) => {
          for (const m of state.milestones) {
            const s = m.submissions.find((x) => x.id === where.id);
            if (s) Object.assign(s, data);
          }
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
  const query = new ContractsQueryService(prisma as never);
  const step = new ContractStepService(prisma as never, events as never, query);
  const ending = new ContractEndingService(wallet as never, events as never);
  const service = new ContractsService(
    step,
    wallet as never,
    events as never,
    ending,
  );
  const amendments = new AmendmentsService(
    prisma as never,
    step,
    events as never,
    ending,
  );
  return { prisma, wallet, events, service, query, ending, amendments, state };
}

function contractLocked(prisma: { $queryRaw: jest.Mock }) {
  const calls = prisma.$queryRaw.mock.calls.map(
    ([strings, ...values]: [string[], ...unknown[]]) => ({
      sql: strings.join('?'),
      values,
    }),
  );
  expect(calls).toContainEqual({
    sql: expect.stringMatching(/"contracts".*FOR UPDATE/),
    values: [20],
  });
}

describe('ContractsService', () => {
  const OLD_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
  beforeAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
  });
  afterAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = OLD_CLOUD;
  });

  describe('fund', () => {
    it('locks the contract, holds the credits once, sets FUNDED, clears the warnings and tells the freelancer with a chat line', async () => {
      const { prisma, wallet, events, service, state } = setup([
        milestone(31, 1, M.PENDING, 300),
        milestone(32, 2, M.PENDING, 700),
      ]);

      const result = await service.fund(31, client);

      contractLocked(prisma);
      expect(wallet.hold).toHaveBeenCalledTimes(1);
      expect(wallet.hold).toHaveBeenCalledWith(prisma, {
        clientId: 3,
        freelancerId: 9,
        amount: 300,
        contractId: 20,
        milestoneId: 31,
      });
      const m = state.milestones[0];
      expect(m.status).toBe(M.FUNDED);
      expect(m.fundedAt).toBeInstanceOf(Date);
      expect(m).toMatchObject({
        lateWarnedAt: null,
        silentWarnedAt: null,
        unfundedWarnedAt: null,
      });
      expect(events.record).toHaveBeenCalledWith(prisma, {
        contractId: 20,
        actorId: 3,
        type: 'milestone_funded',
        data: { milestoneId: 31, position: 1, amount: 300 },
      });
      expect(events.announce).toHaveBeenCalledTimes(1);
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 9,
          actorId: 3,
          actorName: 'Lan Tran',
          kind: 'contract',
          step: 'milestone_funded',
          contractId: 20,
          milestoneId: 31,
          jobTitle: 'Bakery logo',
          position: 1,
          amount: 300,
          recipientSide: 'freelancer',
          chat: expect.objectContaining({ fromId: 3, toId: 9 }),
        }),
      );
      expect(result.message).toBe('Milestone funded');
      expect(result.content).toMatchObject({
        id: 20,
        viewerRole: 'client',
        paid: 0,
        held: 300,
        remaining: 700,
      });
      expect(result.content.milestones[0].warnings).toEqual({
        late: false,
        silent: false,
        unfunded: false,
      });
    });

    it('a second Fund of the same milestone gets 409 "Milestone 1 is already funded." and holds nothing more (Review Focus 1)', async () => {
      const { wallet, events, service } = setup([
        milestone(31, 1, M.PENDING, 300),
      ]);

      await service.fund(31, client);
      await expect(service.fund(31, client)).rejects.toThrow(
        new ConflictException('Milestone 1 is already funded.'),
      );

      expect(wallet.hold).toHaveBeenCalledTimes(1);
      expect(events.announce).toHaveBeenCalledTimes(1);
    });

    it('too few credits: 409 with the exact sentence and no change', async () => {
      const { wallet, events, service, state } = setup([
        milestone(31, 1, M.PENDING, 2000),
      ]);
      wallet.hold.mockRejectedValue(new InsufficientCreditsError(1250, 2000));

      const error = await service.fund(31, client).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as Error).message).toBe(
        'You have 1,250 credits; this milestone needs 2,000. Top up or ask to lower the amount.',
      );
      expect(state.milestones[0].status).toBe(M.PENDING);
      expect(events.announce).not.toHaveBeenCalled();
    });

    it('milestone 2 while milestone 1 is SUBMITTED: 409', async () => {
      const { wallet, service } = setup([
        milestone(31, 1, M.SUBMITTED, 300),
        milestone(32, 2, M.PENDING, 700),
      ]);

      await expect(service.fund(32, client)).rejects.toThrow(
        new ConflictException(
          'Fund milestone 2 after milestone 1 is approved.',
        ),
      );
      expect(wallet.hold).not.toHaveBeenCalled();
    });

    it('the freelancer cannot fund (403) and a stranger gets "This contract is not yours." (403)', async () => {
      const { wallet, service } = setup([milestone(31, 1, M.PENDING, 300)]);

      await expect(service.fund(31, freelancer)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.fund(31, stranger)).rejects.toThrow(
        new ForbiddenException('This contract is not yours.'),
      );
      expect(wallet.hold).not.toHaveBeenCalled();
    });

    it('an imported contract funds like any other (one hold)', async () => {
      const { wallet, service, state } = setup([
        milestone(31, 1, M.PENDING, 1000),
      ]);
      state.imported = true;
      state.proposalId = null as unknown as number;

      const result = await service.fund(31, client);

      expect(wallet.hold).toHaveBeenCalledTimes(1);
      expect(result.content).toMatchObject({ imported: true, held: 1000 });
    });
  });

  describe('submit and request changes', () => {
    it('an empty note is 400 and a javascript: link is 400, nothing saved', async () => {
      const { prisma, service } = setup([milestone(31, 1, M.FUNDED, 300)]);

      await expect(
        service.submit(31, freelancer, { note: '   ', images: [], links: [] }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.submit(31, freelancer, {
          note: 'Done',
          images: [],
          links: ['javascript:alert(1)'],
        }),
      ).rejects.toThrow(
        new BadRequestException('links must be up to 10 web links.'),
      );
      await expect(
        service.submit(31, freelancer, {
          note: 'Done',
          images: ['https://evil.example.com/a.png'],
          links: [],
        }),
      ).rejects.toThrow(/images/);
      expect(prisma.submission.create).not.toHaveBeenCalled();
    });

    it('submit → request changes → submit: submissions 1 and 2, feedback on 1, flags cleared each time', async () => {
      const { events, service, state } = setup([
        milestone(31, 1, M.FUNDED, 300),
      ]);
      const m = () => state.milestones[0];

      await service.submit(31, freelancer, {
        note: 'First try',
        images: [image],
        links: ['https://figma.com/file/1'],
      });
      expect(m().status).toBe(M.SUBMITTED);
      expect(m().submittedAt).toBeInstanceOf(Date);
      expect(m().lateWarnedAt).toBeNull();

      m().silentWarnedAt = new Date(); // as if the sweeper warned the client
      await service.requestChanges(31, client, '  Bigger letters please ');
      expect(m().status).toBe(M.CHANGES_REQUESTED);
      expect(m().changesRequestedAt).toBeInstanceOf(Date);
      expect(m().silentWarnedAt).toBeNull();

      m().lateWarnedAt = new Date();
      const result = await service.submit(31, freelancer, {
        note: 'Second try',
        images: [],
        links: [],
      });
      expect(m().lateWarnedAt).toBeNull();

      const subs = result.content.milestones[0].submissions;
      expect(subs.map((s) => s.number)).toEqual([2, 1]); // newest first
      expect(subs[1]).toMatchObject({
        note: 'First try',
        images: [image],
        links: ['https://figma.com/file/1'],
        feedback: 'Bigger letters please',
      });
      expect(subs[0].feedback).toBeNull();
      expect(events.record).toHaveBeenCalledWith(expect.anything(), {
        contractId: 20,
        actorId: 3,
        type: 'changes_requested',
        data: { milestoneId: 31, position: 1, note: 'Bigger letters please' },
      });
      expect(events.record).toHaveBeenCalledWith(expect.anything(), {
        contractId: 20,
        actorId: 9,
        type: 'work_submitted',
        data: { milestoneId: 31, position: 1, submission: 2 },
      });
      // Submit tells the client with a chat line; request changes tells the freelancer.
      expect(events.announce).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          recipientId: 3,
          step: 'work_submitted',
          recipientSide: 'client',
          chat: expect.objectContaining({ fromId: 9, toId: 3 }),
        }),
      );
      expect(events.announce).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          recipientId: 9,
          step: 'changes_requested',
          recipientSide: 'freelancer',
        }),
      );
    });

    it('the client cannot submit and a PENDING milestone cannot be submitted', async () => {
      const { service } = setup([
        milestone(31, 1, M.FUNDED, 300),
        milestone(32, 2, M.PENDING, 300),
      ]);
      const work = { note: 'x', images: [], links: [] };

      await expect(service.submit(31, client, work)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(service.submit(32, freelancer, work)).rejects.toThrow(
        new ConflictException('Milestone 2 is not funded yet right now.'),
      );
    });

    it('request changes with an empty note is 400', async () => {
      const { service } = setup([milestone(31, 1, M.SUBMITTED, 300)]);
      await expect(service.requestChanges(31, client, '')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('approve', () => {
    it('approving a middle milestone releases once and the contract stays ACTIVE', async () => {
      const { wallet, events, service, state } = setup([
        milestone(31, 1, M.SUBMITTED, 300),
        milestone(32, 2, M.PENDING, 700),
      ]);

      const result = await service.approve(31, client);

      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          step: 'milestone_approved',
          jobTitle: 'Bakery logo',
          position: 1,
          amount: 300,
        }),
      );
      expect(wallet.release).toHaveBeenCalledTimes(1);
      expect(state.milestones[0].status).toBe(M.APPROVED);
      expect(state.status).toBe(C.ACTIVE);
      expect(result.content).toMatchObject({ paid: 300, remaining: 700 });
    });

    it('approving the last milestone: release once, COMPLETED, completedAt, chat line', async () => {
      const { prisma, wallet, events, service, state } = setup([
        milestone(31, 1, M.APPROVED, 300),
        milestone(32, 2, M.SUBMITTED, 700),
      ]);

      const result = await service.approve(32, client);

      expect(wallet.release).toHaveBeenCalledTimes(1);
      expect(wallet.release).toHaveBeenCalledWith(prisma, {
        clientId: 3,
        freelancerId: 9,
        amount: 700,
        contractId: 20,
        milestoneId: 32,
      });
      expect(state.milestones[1].approvedAt).toBeInstanceOf(Date);
      expect(state.status).toBe(C.COMPLETED);
      expect(state.completedAt).toBeInstanceOf(Date);
      expect(events.record).toHaveBeenCalledWith(prisma, {
        contractId: 20,
        actorId: 3,
        type: 'contract_completed',
      });
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 9,
          step: 'contract_completed',
          chat: expect.objectContaining({ fromId: 3, toId: 9 }),
        }),
      );
      expect(result.content).toMatchObject({
        status: C.COMPLETED,
        paid: 1000,
        held: 0,
        canReview: true,
      });
    });

    it('a second Approve (or one after the sweeper approved) gets 409 and releases nothing more (Review Focus 2)', async () => {
      const { wallet, service } = setup([milestone(31, 1, M.SUBMITTED, 300)]);

      await service.approve(31, client);
      await expect(service.approve(31, client)).rejects.toThrow(
        ConflictException,
      );
      expect(wallet.release).toHaveBeenCalledTimes(1);
    });
  });

  describe('end (client alone)', () => {
    it('with a FUNDED milestone: 409 with the exact sentence', async () => {
      const { wallet, service, state } = setup([
        milestone(31, 1, M.FUNDED, 300),
        milestone(32, 2, M.PENDING, 700),
      ]);

      await expect(service.end(20, client)).rejects.toThrow(
        new ConflictException(
          'Credits are held on this contract. Ask the freelancer to end it instead.',
        ),
      );
      expect(state.status).toBe(C.ACTIVE);
      expect(wallet.refund).not.toHaveBeenCalled();
    });

    it('with nothing held: ENDED (CLIENT_ENDED), PENDING milestones CANCELLED, APPROVED kept', async () => {
      const { prisma, wallet, events, service, state } = setup([
        milestone(31, 1, M.APPROVED, 300),
        milestone(32, 2, M.PENDING, 700),
      ]);

      const result = await service.end(20, client);

      contractLocked(prisma);
      expect(state.status).toBe(C.ENDED);
      expect(state.endReason).toBe('CLIENT_ENDED');
      expect(state.endedAt).toBeInstanceOf(Date);
      expect(state.milestones.map((m) => m.status)).toEqual([
        M.APPROVED,
        M.CANCELLED,
      ]);
      expect(wallet.refund).not.toHaveBeenCalled();
      expect(wallet.release).not.toHaveBeenCalled();
      expect(events.record).toHaveBeenCalledWith(prisma, {
        contractId: 20,
        actorId: 3,
        type: 'contract_ended',
        data: { reason: 'CLIENT_ENDED' },
      });
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 9, step: 'contract_ended' }),
      );
      expect(result.content).toMatchObject({
        status: C.ENDED,
        endReason: 'CLIENT_ENDED',
        canReview: true,
      });
    });

    it('the freelancer cannot end alone (403) and an ended contract gives 409', async () => {
      const { service } = setup([milestone(31, 1, M.PENDING, 300)]);
      await expect(service.end(20, freelancer)).rejects.toThrow(
        ForbiddenException,
      );
      await service.end(20, client);
      await expect(service.end(20, client)).rejects.toThrow(
        new ConflictException('This contract has ended.'),
      );
    });
  });

  describe('reading', () => {
    it('a stranger gets 403; an admin may read', async () => {
      const { query } = setup([milestone(31, 1, M.PENDING, 300)]);
      await expect(query.detail(20, stranger)).rejects.toThrow(
        new ForbiddenException('This contract is not yours.'),
      );
      await expect(
        query.detail(20, { id: 1, role: Role.ADMIN }),
      ).resolves.toMatchObject({ id: 20 });
    });

    it('the client reads every submission of an ENDED contract', async () => {
      const { query, state } = setup(
        [milestone(31, 1, M.APPROVED, 300), milestone(32, 2, M.CANCELLED, 700)],
        C.ENDED,
      );
      const sub = (id: number, number: number): FakeSubmission => ({
        id,
        milestoneId: 32,
        number,
        authorId: 9,
        note: `Try ${number}`,
        images: [],
        links: [],
        feedback: null,
        createdAt: new Date(),
      });
      state.milestones[1].submissions = [sub(2, 2), sub(1, 1)];
      state.milestones[0].submissions = [{ ...sub(3, 1), milestoneId: 31 }];

      const detail = await query.detail(20, client);

      expect(detail.milestones[0].submissions).toHaveLength(1);
      expect(detail.milestones[1].submissions.map((s) => s.number)).toEqual([
        2, 1,
      ]);
    });

    it('the history reads the proposal rows and the contract rows, oldest first', async () => {
      const { prisma, query } = setup([milestone(31, 1, M.PENDING, 300)]);
      await query.detail(20, freelancer);
      expect(prisma.contractEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ contractId: 20 }, { proposalId: 5 }] },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
      );
    });
  });

  describe('the end-request choice follows the work it was made for', () => {
    const WORK_CHANGED = new ConflictException(
      'Work was submitted after the end request. Ask the client to send a new one.',
    );
    const work = { note: 'Here it is', images: [image], links: [] };

    it('stores the SUBMITTED milestone and its latest submission with the choice', async () => {
      const { service, amendments, state } = setup([
        milestone(31, 1, M.FUNDED, 300),
      ]);
      await service.submit(31, freelancer, work);

      await amendments.requestEnd(20, client, { submittedChoice: 'APPROVE' });

      expect(state.endRequestChoice).toBe('APPROVE');
      expect(state.endRequestMilestoneId).toBe(31);
      expect(state.endRequestSubmissionId).toBe(600);
    });

    it('same work still submitted: the freelancer accepts and APPROVE pays it', async () => {
      const { service, amendments, wallet, state } = setup([
        milestone(31, 1, M.FUNDED, 300),
      ]);
      await service.submit(31, freelancer, work);
      await amendments.requestEnd(20, client, { submittedChoice: 'APPROVE' });

      await amendments.acceptEnd(20, freelancer, {});

      expect(wallet.release).toHaveBeenCalledTimes(1);
      expect(state.status).toBe(C.ENDED);
    });

    it('case (a): changes requested, version 2 submitted, then accept is 409 and nothing is paid', async () => {
      const { service, amendments, wallet, state } = setup([
        milestone(31, 1, M.FUNDED, 300),
        milestone(32, 2, M.PENDING, 700),
      ]);
      await service.submit(31, freelancer, work);
      await amendments.requestEnd(20, client, { submittedChoice: 'APPROVE' });

      await service.requestChanges(31, client, 'Bigger letters please');
      expect(state.endRequestChoice).toBeNull();
      expect(state.endRequestMilestoneId).toBeNull();
      expect(state.endRequestSubmissionId).toBeNull();
      expect(state.endRequestedById).toBe(3);
      await service.submit(31, freelancer, work);

      await expect(amendments.acceptEnd(20, freelancer, {})).rejects.toThrow(
        WORK_CHANGED,
      );
      expect(wallet.release).not.toHaveBeenCalled();
      expect(state.status).toBe(C.ACTIVE);
    });

    it('case (b): milestone 1 approved by hand, milestone 2 funded and submitted, then accept is 409', async () => {
      const { service, amendments, wallet, state } = setup([
        milestone(31, 1, M.FUNDED, 300),
        milestone(32, 2, M.PENDING, 700),
      ]);
      await service.submit(31, freelancer, work);
      await amendments.requestEnd(20, client, { submittedChoice: 'APPROVE' });

      await service.approve(31, client);
      expect(state.endRequestChoice).toBeNull();
      expect(state.endRequestedById).toBe(3);
      await service.fund(32, client);
      await service.submit(32, freelancer, work);

      await expect(amendments.acceptEnd(20, freelancer, {})).rejects.toThrow(
        WORK_CHANGED,
      );
      // Only the hand approval of milestone 1 paid anything.
      expect(wallet.release).toHaveBeenCalledTimes(1);
      expect(state.milestones[1].status).toBe(M.SUBMITTED);
      expect(state.status).toBe(C.ACTIVE);
    });

    it('a stored choice for other work (submission id differs) is 409, never paid', async () => {
      const { service, amendments, wallet, state } = setup([
        milestone(31, 1, M.FUNDED, 300),
      ]);
      await service.submit(31, freelancer, work);
      Object.assign(state, {
        endRequestedById: 3,
        endRequestChoice: 'APPROVE',
        endRequestMilestoneId: 31,
        endRequestSubmissionId: 1,
        endRequestedAt: new Date(),
      });

      await expect(amendments.acceptEnd(20, freelancer, {})).rejects.toThrow(
        WORK_CHANGED,
      );
      expect(wallet.release).not.toHaveBeenCalled();
    });

    it('approving the last milestone completes the contract and closes the end request and an OPEN amendment', async () => {
      const { service, amendments, prisma, state } = setup([
        milestone(31, 1, M.FUNDED, 300),
      ]);
      await service.submit(31, freelancer, work);
      await amendments.requestEnd(20, client, { submittedChoice: 'REFUND' });

      await service.approve(31, client);

      expect(state.status).toBe(C.COMPLETED);
      expect(state.endRequestedById).toBeNull();
      expect(state.endRequestChoice).toBeNull();
      expect(prisma.amendment.updateMany).toHaveBeenCalledWith({
        where: { contractId: 20, status: 'OPEN' },
        data: { status: 'CANCELLED', decidedAt: expect.any(Date) as Date },
      });
    });
  });
});

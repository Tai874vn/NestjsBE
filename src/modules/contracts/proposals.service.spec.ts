import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProposalStatus } from '@prisma/client';
import { ProposalsService } from './proposals.service';

const P = ProposalStatus;
const DAY = 24 * 60 * 60 * 1000;
const client = { id: 3 };
const freelancer = { id: 9 };
const stranger = { id: 50 };

/** A date `days` from now, as ISO text. */
function inDays(days: number) {
  return new Date(Date.now() + days * DAY).toISOString();
}

function versionBody(overrides: Record<string, unknown> = {}) {
  return {
    brief: 'A logo for my bakery',
    referenceLinks: ['https://example.com/style'],
    referenceImages: [],
    deadline: inDays(10),
    milestones: [
      { title: 'Sketches', dueDate: inDays(3), amount: 300 },
      {
        title: 'Final files',
        description: 'SVG and PNG',
        dueDate: inDays(9),
        amount: 700,
      },
    ],
    ...overrides,
  };
}

function storedVersion(number: number, authorId: number, total = 1000) {
  return {
    id: 100 + number,
    proposalId: 5,
    number,
    authorId,
    brief: `Brief v${number}`,
    referenceLinks: [],
    referenceImages: [],
    deadline: new Date(inDays(10)),
    milestones: [
      { title: 'Sketches', dueDate: inDays(3), amount: 300 },
      {
        title: 'Final files',
        description: 'SVG and PNG',
        dueDate: inDays(9),
        amount: total - 300,
      },
    ],
    total,
    createdAt: new Date(),
  };
}

/** One proposal row with everything the lock step and the detail page read. */
function proposalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    jobId: 4,
    clientId: 3,
    freelancerId: 9,
    status: P.OPEN,
    latestVersion: 1,
    turnUserId: 9,
    expiresAt: new Date(Date.now() + 7 * DAY),
    declineNote: null,
    decidedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    job: { id: 4, title: 'Bakery logo', image: null, price: 1000 },
    client: { id: 3, name: 'Lan Tran', avatar: null },
    freelancer: { id: 9, name: 'Minh Le', avatar: 'a.png' },
    versions: [storedVersion(1, 3)],
    contract: null,
    events: [],
    ...overrides,
  };
}

describe('ProposalsService', () => {
  function createService(row = proposalRow()) {
    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
      job: {
        findUnique: jest.fn().mockResolvedValue({
          id: 4,
          title: 'Bakery logo',
          creatorId: 9,
        }),
      },
      proposal: {
        create: jest.fn().mockResolvedValue({ id: 5 }),
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([row]),
        count: jest.fn().mockResolvedValue(1),
      },
      proposalVersion: { create: jest.fn().mockResolvedValue({}) },
      contract: { create: jest.fn().mockResolvedValue({ id: 77 }) },
    };
    // The transaction mock runs the callback with this same mock as `tx`.
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    const events = {
      record: jest.fn().mockResolvedValue(undefined),
      announce: jest.fn().mockResolvedValue(undefined),
    };
    const service = new ProposalsService(prisma as never, events as never);
    return { prisma, events, service };
  }

  /** The SQL text of each $queryRaw call, in order. */
  function locks(prisma: { $queryRaw: jest.Mock }) {
    return prisma.$queryRaw.mock.calls.map(
      ([strings, ...values]: [string[], ...unknown[]]) => ({
        sql: strings.join('?'),
        values,
      }),
    );
  }

  function expectProposalLocked(prisma: { $queryRaw: jest.Mock }) {
    expect(locks(prisma)).toContainEqual({
      sql: expect.stringMatching(/"proposals".*FOR UPDATE/),
      values: [5],
    });
  }

  describe('create', () => {
    it('makes an OPEN proposal, version 1, turn = freelancer, then tells the freelancer with a chat line', async () => {
      const { prisma, events, service } = createService();
      const before = Date.now();

      const result = await service.create(client, {
        ...versionBody(),
        jobId: 4,
      });

      const data = prisma.proposal.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        jobId: 4,
        clientId: 3,
        freelancerId: 9,
        status: P.OPEN,
        latestVersion: 1,
        turnUserId: 9,
      });
      // Expires 7 days after the version.
      const versionTime = prisma.proposalVersion.create.mock.calls[0][0].data
        .createdAt as Date;
      expect(versionTime.getTime()).toBeGreaterThanOrEqual(before);
      expect((data.expiresAt as Date).getTime()).toBe(
        versionTime.getTime() + 7 * DAY,
      );
      expect(prisma.proposalVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          proposalId: 5,
          number: 1,
          authorId: 3,
          brief: 'A logo for my bakery',
          total: 1000,
          milestones: [
            expect.objectContaining({ title: 'Sketches', amount: 300 }),
            expect.objectContaining({
              title: 'Final files',
              description: 'SVG and PNG',
              amount: 700,
            }),
          ],
        }),
      });
      expect(events.record).toHaveBeenCalledWith(prisma, {
        proposalId: 5,
        actorId: 3,
        type: 'proposal_sent',
        data: { version: 1, total: 1000 },
      });
      expect(events.announce).toHaveBeenCalledTimes(1);
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 9,
          actorId: 3,
          actorName: 'Lan Tran',
          kind: 'proposal',
          step: 'proposal_sent',
          proposalId: 5,
          recipientSide: 'freelancer',
          chat: expect.objectContaining({ fromId: 3, toId: 9 }),
        }),
      );
      expect(result.content).toMatchObject({
        id: 5,
        status: P.OPEN,
        viewerRole: 'client',
      });
    });

    it('refuses a proposal on your own service (403), nothing saved', async () => {
      const { prisma, service } = createService();

      await expect(
        service.create(freelancer, { ...versionBody(), jobId: 4 }),
      ).rejects.toThrow(
        new ForbiddenException(
          'You cannot send a proposal to your own service.',
        ),
      );
      expect(prisma.proposal.create).not.toHaveBeenCalled();
    });

    it('gives 404 for a missing service', async () => {
      const { prisma, service } = createService();
      prisma.job.findUnique.mockResolvedValue(null);

      await expect(
        service.create(client, { ...versionBody(), jobId: 4 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('gives 409 when the client already has an open proposal (partial unique index)', async () => {
      const { prisma, events, service } = createService();
      prisma.proposal.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('dup', {
          code: 'P2002',
          clientVersion: 'x',
        }),
      );

      await expect(
        service.create(client, { ...versionBody(), jobId: 4 }),
      ).rejects.toThrow(
        new ConflictException(
          'You already have an open proposal for this service.',
        ),
      );
      expect(events.announce).not.toHaveBeenCalled();
    });

    it('gives 400 when the first due date is not in the future', async () => {
      const { prisma, service } = createService();
      const body = versionBody({
        milestones: [{ title: 'Late', dueDate: inDays(-1), amount: 5 }],
      });

      await expect(service.create(client, { ...body, jobId: 4 })).rejects.toThrow(
        new BadRequestException('The first due date must be in the future.'),
      );
      expect(prisma.proposal.create).not.toHaveBeenCalled();
    });
  });

  describe('counter', () => {
    it('freelancer counters: version 2, turn passes to the client, chat line', async () => {
      const { prisma, events, service } = createService();

      const before = Date.now();
      await service.counter(5, freelancer, versionBody());
      const after = Date.now();

      expectProposalLocked(prisma);
      // A new version restarts the 7 days.
      const expiresAt = (
        prisma.proposal.update.mock.calls[0][0].data.expiresAt as Date
      ).getTime();
      expect(expiresAt).toBeGreaterThanOrEqual(before + 7 * DAY);
      expect(expiresAt).toBeLessThanOrEqual(after + 7 * DAY);
      expect(prisma.proposalVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          proposalId: 5,
          number: 2,
          authorId: 9,
          total: 1000,
        }),
      });
      const update = prisma.proposal.update.mock.calls[0][0];
      expect(update.where).toEqual({ id: 5 });
      expect(update.data).toMatchObject({ latestVersion: 2, turnUserId: 3 });
      expect(events.record).toHaveBeenCalledWith(prisma, {
        proposalId: 5,
        actorId: 9,
        type: 'proposal_countered',
        data: { version: 2, total: 1000 },
      });
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 3,
          actorName: 'Minh Le',
          step: 'proposal_countered',
          jobTitle: 'Bakery logo',
          recipientSide: 'client',
          chat: expect.objectContaining({ fromId: 9, toId: 3 }),
        }),
      );
    });

    it("refuses a counter when it is the other person's turn (409)", async () => {
      const { prisma, service } = createService();

      await expect(service.counter(5, client, versionBody())).rejects.toThrow(
        new ConflictException("It is the other person's turn."),
      );
      expect(prisma.proposalVersion.create).not.toHaveBeenCalled();
    });

    it('refuses someone who is not on the proposal (403)', async () => {
      const { service } = createService();

      await expect(
        service.counter(5, stranger, versionBody()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('accept', () => {
    // Review Focus 3: the user read version 1, but version 2 was sent meanwhile.
    it('refuses version 1 when the latest is 2 (409), no contract', async () => {
      const { prisma, events, service } = createService(
        proposalRow({
          latestVersion: 2,
          turnUserId: 3,
          versions: [storedVersion(1, 3), storedVersion(2, 9)],
        }),
      );

      await expect(service.accept(5, client, 1)).rejects.toThrow(
        new ConflictException(
          'A newer version was sent. Read it before you accept.',
        ),
      );
      expectProposalLocked(prisma);
      expect(prisma.contract.create).not.toHaveBeenCalled();
      expect(events.announce).not.toHaveBeenCalled();
    });

    it('accepts the latest version: contract with its milestones and total, events in order', async () => {
      const latest = storedVersion(2, 9, 1200);
      const { prisma, events, service } = createService(
        proposalRow({
          latestVersion: 2,
          turnUserId: 3,
          versions: [latest],
        }),
      );

      await service.accept(5, client, 2);

      expectProposalLocked(prisma);
      expect(prisma.contract.create).toHaveBeenCalledWith({
        data: {
          proposalId: 5,
          jobId: 4,
          clientId: 3,
          freelancerId: 9,
          title: 'Bakery logo',
          brief: 'Brief v2',
          referenceLinks: [],
          referenceImages: [],
          deadline: latest.deadline,
          total: 1200,
          milestones: {
            create: [
              {
                position: 1,
                title: 'Sketches',
                description: null,
                dueDate: new Date(latest.milestones[0].dueDate),
                amount: 300,
                status: 'PENDING',
              },
              {
                position: 2,
                title: 'Final files',
                description: 'SVG and PNG',
                dueDate: new Date(latest.milestones[1].dueDate),
                amount: 900,
                status: 'PENDING',
              },
            ],
          },
        },
        select: { id: true },
      });
      expect(prisma.proposal.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: expect.objectContaining({
          status: P.ACCEPTED,
          turnUserId: null,
          decidedAt: expect.any(Date),
        }),
      });
      expect(events.record.mock.calls.map(([, event]) => event)).toEqual([
        {
          proposalId: 5,
          contractId: 77,
          actorId: 3,
          type: 'proposal_accepted',
          data: { version: 2 },
        },
        {
          proposalId: 5,
          contractId: 77,
          actorId: 3,
          type: 'contract_started',
          data: { total: 1200 },
        },
      ]);
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 9,
          kind: 'contract',
          step: 'proposal_accepted',
          proposalId: 5,
          contractId: 77,
          recipientSide: 'freelancer',
          chat: expect.objectContaining({ fromId: 3, toId: 9 }),
        }),
      );
    });

    it('refuses a version whose first due date has passed (409), nothing created', async () => {
      const stale = storedVersion(1, 3);
      stale.milestones[0].dueDate = new Date(Date.now() - 1000).toISOString();
      const { prisma, events, service } = createService(
        proposalRow({ versions: [stale] }),
      );

      await expect(service.accept(5, freelancer, 1)).rejects.toThrow(
        new ConflictException(
          'The first due date has passed. Send a counter-offer with new dates.',
        ),
      );
      expectProposalLocked(prisma);
      expect(prisma.contract.create).not.toHaveBeenCalled();
      expect(prisma.proposal.update).not.toHaveBeenCalled();
      expect(events.record).not.toHaveBeenCalled();
      expect(events.announce).not.toHaveBeenCalled();
    });

    it('refuses a proposal that was already accepted (409)', async () => {
      const { service } = createService(
        proposalRow({ status: P.ACCEPTED, turnUserId: null }),
      );

      await expect(service.accept(5, freelancer, 1)).rejects.toThrow(
        new ConflictException('This proposal was already accepted.'),
      );
    });

    it('refuses an OPEN proposal whose 7 days have passed (409)', async () => {
      const { prisma, service } = createService(
        proposalRow({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.accept(5, freelancer, 1)).rejects.toThrow(
        new ConflictException('This proposal already expired.'),
      );
      expect(prisma.contract.create).not.toHaveBeenCalled();
    });
  });

  describe('decline and withdraw', () => {
    it('declines with a note, no chat line', async () => {
      const { prisma, events, service } = createService();

      await service.decline(5, freelancer, 'Too busy this month');

      expect(prisma.proposal.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: expect.objectContaining({
          status: P.DECLINED,
          declineNote: 'Too busy this month',
          turnUserId: null,
        }),
      });
      expect(events.record).toHaveBeenCalledWith(prisma, {
        proposalId: 5,
        actorId: 9,
        type: 'proposal_declined',
        data: { note: 'Too busy this month' },
      });
      const notice = events.announce.mock.calls[0][0];
      expect(notice).toMatchObject({ recipientId: 3, step: 'proposal_declined' });
      expect(notice.chat).toBeUndefined();
    });

    it('lets the latest author withdraw', async () => {
      const { prisma, events, service } = createService();

      await service.withdraw(5, client);

      expect(prisma.proposal.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: expect.objectContaining({
          status: P.WITHDRAWN,
          turnUserId: null,
        }),
      });
      expect(events.record).toHaveBeenCalledWith(prisma, {
        proposalId: 5,
        actorId: 3,
        type: 'proposal_withdrawn',
      });
    });

    it('refuses a withdraw by the person who did not send the latest version (403)', async () => {
      const { prisma, service } = createService();

      await expect(service.withdraw(5, freelancer)).rejects.toThrow(
        new ForbiddenException(
          'Only the person who sent the latest version can withdraw it.',
        ),
      );
      expect(prisma.proposal.update).not.toHaveBeenCalled();
    });
  });

  describe('reading', () => {
    it('shows the detail to either side, not to others', async () => {
      const { service } = createService(
        proposalRow({
          events: [
            {
              id: 1,
              proposalId: 5,
              contractId: null,
              type: 'proposal_sent',
              data: { version: 1, total: 1000 },
              createdAt: new Date('2026-11-24T00:00:00Z'),
              actor: { id: 3, name: 'Lan Tran', avatar: null },
            },
          ],
        }),
      );

      const result = await service.findOne(5, freelancer);
      expect(result.content).toMatchObject({
        id: 5,
        viewerRole: 'freelancer',
        contractId: null,
        latestVersion: 1,
        versions: [expect.objectContaining({ number: 1, authorId: 3 })],
        events: [
          expect.objectContaining({
            type: 'proposal_sent',
            actor: { id: 3, name: 'Lan Tran', avatar: null },
            createdAt: '2026-11-24T00:00:00.000Z',
          }),
        ],
      });
      await expect(service.findOne(5, stranger)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('role=freelancer lists only proposals on the viewer’s services', async () => {
      const { prisma, service } = createService();

      const result = await service.list(freelancer, {
        role: 'freelancer',
        status: P.OPEN,
        page: 1,
        pageSize: 20,
      });

      const args = prisma.proposal.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ freelancerId: 9, status: P.OPEN });
      expect(prisma.proposal.count).toHaveBeenCalledWith({ where: args.where });
      expect(result.content).toMatchObject({
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
        data: [
          expect.objectContaining({
            id: 5,
            viewerRole: 'freelancer',
            total: 1000,
          }),
        ],
      });
    });
  });
});

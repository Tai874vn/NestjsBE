import { ConflictException, ForbiddenException } from '@nestjs/common';
import {
  HiringApplicationStatus,
  HiringPostStatus,
  InterviewStatus,
} from '@prisma/client';
import { Role } from '../../common/constants/roles';
import { ApplicationPipelineService } from './application-pipeline.service';
import { ApplicationsQueryService } from './applications-query.service';
import { ApplicationsService } from './applications.service';

const S = HiringApplicationStatus;
const recruiter = { id: 2, role: Role.EMPLOYER };
const candidate = { id: 7, role: Role.USER };

describe('ApplicationsService', () => {
  function lockedApplication(overrides: Record<string, unknown> = {}) {
    return {
      id: 99,
      hiringPostId: 10,
      applicantId: 7,
      status: S.APPLIED,
      hiringPost: {
        id: 10,
        title: 'Senior Test Engineer',
        status: HiringPostStatus.OPEN,
        openings: 1,
        recruiterId: 2,
        recruiter: { name: 'Lan' },
      },
      applicant: { name: 'Minh' },
      interviews: [] as { id: number; status: InterviewStatus }[],
      ...overrides,
    };
  }

  function createService(application = lockedApplication()) {
    const prisma = {
      // The row locks (SELECT ... FOR UPDATE).
      $queryRaw: jest.fn().mockResolvedValue([]),
      // The transaction mock runs the callback with this same mock as `tx`.
      $transaction: jest.fn(),
      hiringApplication: {
        findUnique: jest.fn().mockResolvedValue(application),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
      },
      hiringPost: { update: jest.fn().mockResolvedValue({}) },
      interview: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    const events = {
      record: jest.fn().mockResolvedValue(undefined),
      announce: jest.fn().mockResolvedValue(undefined),
    };
    const sweeper = {
      sweep: jest.fn().mockResolvedValue([]),
      announceSwept: jest.fn().mockResolvedValue(undefined),
    };
    const query = { detail: jest.fn().mockResolvedValue({ id: 99 }) };
    const pipeline = new ApplicationPipelineService(
      prisma as never,
      events as never,
      sweeper as never,
      query as never,
    );
    const service = new ApplicationsService(
      pipeline,
      events as never,
      sweeper as never,
      query as never,
    );
    return { prisma, events, sweeper, query, service };
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

  function expectApplicationLocked(prisma: { $queryRaw: jest.Mock }) {
    expect(locks(prisma)).toContainEqual({
      sql: expect.stringMatching(/"hiring_applications".*FOR UPDATE/),
      values: [99],
    });
  }

  it('shortlists: locks the row, writes REVIEWING and the event, then tells the candidate', async () => {
    const { prisma, events, query, service } = createService();

    const result = await service.shortlist(99, recruiter);

    expectApplicationLocked(prisma);
    expect(prisma.hiringApplication.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { status: S.REVIEWING },
    });
    expect(events.record).toHaveBeenCalledWith(prisma, {
      applicationId: 99,
      actorId: 2,
      type: 'shortlisted',
    });
    expect(events.announce).toHaveBeenCalledWith({
      recipientId: 7,
      actorId: 2,
      kind: 'application',
      title: 'You are on the shortlist',
      body: 'Lan shortlisted you for Senior Test Engineer.',
      applicationId: 99,
      postId: 10,
      forRecruiter: false,
    });
    expect(query.detail).toHaveBeenCalledWith(99, recruiter);
    expect(result).toEqual({ message: expect.any(String), content: { id: 99 } });
  });

  it('a candidate calling shortlist gets 403 and nothing is written', async () => {
    const { prisma, events, service } = createService();

    await expect(service.shortlist(99, candidate)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(prisma.hiringApplication.update).not.toHaveBeenCalled();
    expect(events.announce).not.toHaveBeenCalled();
  });

  it('another recruiter (not the owner) gets 403 and nothing is written', async () => {
    const { prisma, events, service } = createService();

    await expect(
      service.shortlist(99, { id: 3, role: Role.EMPLOYER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.hiringApplication.update).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
    expect(events.announce).not.toHaveBeenCalled();
  });

  it('an admin acts as the recruiter', async () => {
    const { prisma, service } = createService();

    await service.shortlist(99, { id: 1, role: Role.ADMIN });

    expect(prisma.hiringApplication.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { status: S.REVIEWING },
    });
  });

  it('a wrong status is 409 with the sentence from the rules', async () => {
    const { service } = createService(lockedApplication({ status: S.WITHDRAWN }));

    await expect(service.shortlist(99, recruiter)).rejects.toThrow(
      new ConflictException('This application was already withdrawn.'),
    );
  });

  it('rejects with a note and cancels the active interview', async () => {
    const { prisma, events, service } = createService(
      lockedApplication({
        status: S.INTERVIEWING,
        interviews: [
          { id: 5, status: InterviewStatus.COMPLETED },
          { id: 6, status: InterviewStatus.SCHEDULED },
        ],
      }),
    );

    await service.reject(99, recruiter, 'Thank you for your time.');

    expectApplicationLocked(prisma);
    expect(prisma.hiringApplication.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: {
        status: S.REJECTED,
        statusReason: null,
        statusNote: 'Thank you for your time.',
      },
    });
    expect(prisma.interview.updateMany).toHaveBeenCalledWith({
      where: {
        id: 6,
        status: {
          in: [
            InterviewStatus.PROPOSED,
            InterviewStatus.RESCHEDULE_REQUESTED,
            InterviewStatus.SCHEDULED,
          ],
        },
      },
      data: { status: InterviewStatus.CANCELLED, cancelledAt: expect.any(Date) },
    });
    expect(events.record).toHaveBeenCalledWith(prisma, {
      applicationId: 99,
      actorId: 2,
      type: 'rejected',
      data: { reason: null, note: 'Thank you for your time.' },
    });
    expect(events.record).toHaveBeenCalledWith(prisma, {
      applicationId: 99,
      actorId: 2,
      type: 'interview_cancelled',
      data: { interviewId: 6 },
    });
    expect(events.announce).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 7,
        kind: 'application',
        title: 'Application update',
        body: 'Senior Test Engineer: not selected. Thank you for your time.',
        forRecruiter: false,
      }),
    );
  });

  it('sends an offer with a chat message from the recruiter', async () => {
    const { prisma, events, service } = createService(
      lockedApplication({
        status: S.INTERVIEWING,
        interviews: [{ id: 5, status: InterviewStatus.COMPLETED }],
      }),
    );

    await service.sendOffer(99, recruiter, 'Start on 1 December.');

    expectApplicationLocked(prisma);
    // Openings left = 1 opening - (hired + offers waiting).
    expect(prisma.hiringApplication.count).toHaveBeenCalledWith({
      where: { hiringPostId: 10, status: { in: [S.HIRED, S.OFFERED] } },
    });
    expect(prisma.hiringApplication.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: {
        status: S.OFFERED,
        offerNote: 'Start on 1 December.',
        offeredAt: expect.any(Date),
        decidedAt: null,
      },
    });
    expect(events.record).toHaveBeenCalledWith(prisma, {
      applicationId: 99,
      actorId: 2,
      type: 'offer_sent',
      data: { note: 'Start on 1 December.' },
    });
    expect(events.announce).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 7,
        kind: 'application',
        title: 'Offer received',
        chat: 'Offer for Senior Test Engineer: Start on 1 December.',
        chatBetween: { recruiterId: 2, candidateId: 7 },
        forRecruiter: false,
      }),
    );
  });

  it('sending an offer locks the post first, then the application, then counts the openings', async () => {
    const { prisma, service } = createService(
      lockedApplication({
        status: S.INTERVIEWING,
        interviews: [{ id: 5, status: InterviewStatus.COMPLETED }],
      }),
    );
    const order: string[] = [];
    prisma.$queryRaw.mockImplementation((strings: string[]) => {
      order.push(strings.join('?').includes('"hiring_posts"') ? 'post' : 'application');
      return Promise.resolve([]);
    });
    prisma.hiringApplication.count.mockImplementation(() => {
      order.push('count');
      return Promise.resolve(0);
    });

    await service.sendOffer(99, recruiter);

    const sql = locks(prisma);
    expect(sql).toHaveLength(2);
    expect(sql[0]).toEqual({
      sql: expect.stringMatching(/"hiring_posts".*FOR UPDATE/),
      values: [10],
    });
    expect(sql[1]).toEqual({
      sql: expect.stringMatching(/"hiring_applications".*FOR UPDATE/),
      values: [99],
    });
    expect(order).toEqual(['post', 'application', 'count']);
  });

  it('an offer without a note says details follow in chat', async () => {
    const { events, service } = createService(
      lockedApplication({
        status: S.INTERVIEWING,
        interviews: [{ id: 5, status: InterviewStatus.COMPLETED }],
      }),
    );

    await service.sendOffer(99, recruiter);

    expect(events.announce).toHaveBeenCalledWith(
      expect.objectContaining({
        chat: 'Offer for Senior Test Engineer: details to follow in chat',
      }),
    );
  });

  it('no offer when every opening is hired or offered', async () => {
    const { prisma, service } = createService(
      lockedApplication({
        status: S.INTERVIEWING,
        interviews: [{ id: 5, status: InterviewStatus.COMPLETED }],
      }),
    );
    prisma.hiringApplication.count.mockResolvedValue(1);

    await expect(service.sendOffer(99, recruiter)).rejects.toThrow(
      new ConflictException('No openings left. Withdraw an offer first.'),
    );
  });

  it('withdraws an offer back to the interview stage', async () => {
    const { prisma, events, service } = createService(
      lockedApplication({ status: S.OFFERED }),
    );

    await service.withdrawOffer(99, recruiter);

    expectApplicationLocked(prisma);
    expect(prisma.hiringApplication.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { status: S.INTERVIEWING, offerNote: null, offeredAt: null },
    });
    expect(events.record).toHaveBeenCalledWith(prisma, {
      applicationId: 99,
      actorId: 2,
      type: 'offer_withdrawn',
    });
    expect(events.announce).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 7,
        title: 'Offer withdrawn',
        forRecruiter: false,
      }),
    );
  });

  describe('accepting an offer', () => {
    it('locks the post first, then the application', async () => {
      const { prisma, service } = createService(
        lockedApplication({
          status: S.OFFERED,
          hiringPost: { ...lockedApplication().hiringPost, openings: 3 },
        }),
      );

      await service.acceptOffer(99, candidate);

      const sql = locks(prisma);
      expect(sql).toHaveLength(2);
      expect(sql[0]).toEqual({
        sql: expect.stringMatching(/"hiring_posts".*FOR UPDATE/),
        values: [10],
      });
      expect(sql[1]).toEqual({
        sql: expect.stringMatching(/"hiring_applications".*FOR UPDATE/),
        values: [99],
      });
    });

    it('sets HIRED, keeps the post open while openings are left, and tells the recruiter', async () => {
      const { prisma, events, sweeper, service } = createService(
        lockedApplication({
          status: S.OFFERED,
          hiringPost: { ...lockedApplication().hiringPost, openings: 3 },
        }),
      );
      prisma.hiringApplication.count.mockResolvedValue(1);

      await service.acceptOffer(99, candidate);

      expect(prisma.hiringApplication.count).toHaveBeenCalledWith({
        where: { hiringPostId: 10, status: S.HIRED },
      });
      expect(prisma.hiringApplication.update).toHaveBeenCalledWith({
        where: { id: 99 },
        data: { status: S.HIRED, decidedAt: expect.any(Date) },
      });
      expect(events.record).toHaveBeenCalledWith(prisma, {
        applicationId: 99,
        actorId: 7,
        type: 'hired',
      });
      expect(prisma.hiringPost.update).not.toHaveBeenCalled();
      expect(sweeper.sweep).not.toHaveBeenCalled();
      expect(events.announce).toHaveBeenCalledWith({
        recipientId: 2,
        actorId: 7,
        kind: 'application',
        title: 'Offer accepted',
        body: 'Minh accepted the offer for Senior Test Engineer.',
        applicationId: 99,
        postId: 10,
        forRecruiter: true,
      });
    });

    it('accepting the last opening closes the post and sweeps it', async () => {
      const { prisma, sweeper, service } = createService(
        lockedApplication({ status: S.OFFERED }),
      );
      sweeper.sweep.mockResolvedValue([11, 12]);

      await service.acceptOffer(99, candidate);

      expect(prisma.hiringPost.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { status: HiringPostStatus.CLOSED },
      });
      expect(sweeper.sweep).toHaveBeenCalledWith(prisma, 10, 'POSITION_FILLED', 7);
      expect(sweeper.announceSwept).toHaveBeenCalledWith(prisma, {
        postId: 10,
        postTitle: 'Senior Test Engineer',
        reason: 'POSITION_FILLED',
        actorId: 7,
        candidateIds: [11, 12],
      });
      // The sweep is saved before anyone is told.
      expect(sweeper.sweep.mock.invocationCallOrder[0]).toBeLessThan(
        sweeper.announceSwept.mock.invocationCallOrder[0],
      );
    });

    it('accepting when the post is already full is 409', async () => {
      // The other candidate took the last opening: the post is closed and this application was swept.
      const { prisma, service } = createService(
        lockedApplication({
          status: S.REJECTED,
          statusReason: 'POSITION_FILLED',
          hiringPost: {
            ...lockedApplication().hiringPost,
            status: HiringPostStatus.CLOSED,
          },
        }),
      );
      prisma.hiringApplication.count.mockResolvedValue(1);

      await expect(service.acceptOffer(99, candidate)).rejects.toThrow(
        new ConflictException('This position has just been filled.'),
      );
      expect(prisma.hiringApplication.update).not.toHaveBeenCalled();
    });

    it('a candidate who is not waiting on an offer gets the normal status answer, not "filled"', async () => {
      // Every opening is hired, but this candidate withdrew earlier: the status rules answer.
      const { prisma, service } = createService(
        lockedApplication({ status: S.WITHDRAWN }),
      );
      prisma.hiringApplication.count.mockResolvedValue(1);

      await expect(service.acceptOffer(99, candidate)).rejects.toThrow(
        new ConflictException('This application was already withdrawn.'),
      );
      expect(prisma.hiringApplication.update).not.toHaveBeenCalled();
    });

    it('no limit (openings null) never closes the post', async () => {
      const { prisma, sweeper, service } = createService(
        lockedApplication({
          status: S.OFFERED,
          hiringPost: { ...lockedApplication().hiringPost, openings: null },
        }),
      );
      prisma.hiringApplication.count.mockResolvedValue(40);

      await service.acceptOffer(99, candidate);

      expect(prisma.hiringPost.update).not.toHaveBeenCalled();
      expect(sweeper.sweep).not.toHaveBeenCalled();
    });

    it('the recruiter cannot accept for the candidate', async () => {
      const { service } = createService(lockedApplication({ status: S.OFFERED }));

      await expect(service.acceptOffer(99, recruiter)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  it('declines an offer with a note and tells the recruiter', async () => {
    const { prisma, events, service } = createService(
      lockedApplication({ status: S.OFFERED }),
    );

    await service.declineOffer(99, candidate, 'I took another role.');

    expectApplicationLocked(prisma);
    expect(prisma.hiringApplication.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: {
        status: S.DECLINED,
        decidedAt: expect.any(Date),
        statusReason: null,
        statusNote: 'I took another role.',
      },
    });
    expect(events.record).toHaveBeenCalledWith(prisma, {
      applicationId: 99,
      actorId: 7,
      type: 'offer_declined',
      data: { note: 'I took another role.' },
    });
    expect(events.announce).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 2,
        title: 'Offer declined',
        body: 'Minh declined the offer for Senior Test Engineer. I took another role.',
        forRecruiter: true,
      }),
    );
  });

  it('withdraws: cancels the active interview and tells the recruiter', async () => {
    const { prisma, events, service } = createService(
      lockedApplication({
        status: S.INTERVIEWING,
        interviews: [{ id: 6, status: InterviewStatus.PROPOSED }],
      }),
    );

    await service.withdraw(99, candidate);

    expectApplicationLocked(prisma);
    expect(prisma.hiringApplication.update).toHaveBeenCalledWith({
      where: { id: 99 },
      data: { status: S.WITHDRAWN, statusReason: null, statusNote: null },
    });
    expect(prisma.interview.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 6 }) }),
    );
    expect(events.record).toHaveBeenCalledWith(prisma, {
      applicationId: 99,
      actorId: 7,
      type: 'withdrawn',
    });
    expect(events.record).toHaveBeenCalledWith(prisma, {
      applicationId: 99,
      actorId: 7,
      type: 'interview_cancelled',
      data: { interviewId: 6 },
    });
    expect(events.announce).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 2,
        title: 'Application withdrawn',
        body: 'Minh withdrew the application for Senior Test Engineer.',
        forRecruiter: true,
      }),
    );
  });

  it('every action on a closed post is 409', async () => {
    const { service } = createService(
      lockedApplication({
        hiringPost: {
          ...lockedApplication().hiringPost,
          status: HiringPostStatus.CLOSED,
        },
      }),
    );

    await expect(service.withdraw(99, candidate)).rejects.toThrow(
      new ConflictException('This hiring post is closed.'),
    );
  });
});

describe('ApplicationsQueryService.detail', () => {
  const now = new Date('2026-11-20T00:00:00.000Z');

  function storedApplication() {
    return {
      id: 99,
      hiringPostId: 10,
      applicantId: 7,
      status: S.INTERVIEWING,
      hiringPost: {
        id: 10,
        recruiterId: 2,
        title: 'Senior Test Engineer',
        occupationCode: '2519.1',
        status: HiringPostStatus.OPEN,
        openings: 1,
        recruiter: { id: 2, name: 'Lan', avatar: null, headline: null },
        _count: { applications: 4 },
      },
      applicant: {
        id: 7,
        name: 'Minh',
        avatar: null,
        headline: 'Tester',
        location: 'Hanoi',
        profileSkills: [{ id: 1, name: 'Selenium', level: null, sortOrder: 0 }],
        resume: {
          data: {
            Occupation: '2519.1',
            Degree: 'Bachelor',
            Jobs: [
              {
                title: 'QA engineer',
                occupation: '2519.1',
                start: '2020-01',
                end: '2024-01',
                current: false,
                description: 'Test plans',
              },
            ],
          },
          predictedSeniority: 'Mid',
          predictedSeniorityMetadata: {
            features: { years_in_occupation: 4, related_years: 0.5 },
          },
        },
      },
      interviews: [{ id: 5, round: 1 }],
      events: [
        {
          id: 1,
          type: 'applied',
          createdAt: now,
          actor: { id: 7, name: 'Minh' },
        },
      ],
    };
  }

  function createQuery() {
    const prisma = {
      hiringApplication: {
        findUnique: jest.fn().mockResolvedValue(storedApplication()),
        groupBy: jest.fn().mockResolvedValue([
          { hiringPostId: 10, status: 'OFFERED', _count: { _all: 1 } },
        ]),
      },
    };
    return { prisma, query: new ApplicationsQueryService(prisma as never) };
  }

  it('the post owner gets the detail with the resume, interviews by round and events in time order', async () => {
    const { prisma, query } = createQuery();

    const detail = await query.detail(99, recruiter);

    const include = prisma.hiringApplication.findUnique.mock.calls[0][0].include;
    expect(include.interviews).toEqual({ orderBy: { round: 'asc' } });
    expect(include.events).toEqual({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { actor: { select: { id: true, name: true } } },
    });
    expect(detail.viewerRole).toBe('recruiter');
    expect(detail.hiringPost).toMatchObject({ id: 10, offersWaiting: 1, hiredCount: 0 });
    expect(detail.applicant).toEqual({
      id: 7,
      name: 'Minh',
      avatar: null,
      headline: 'Tester',
      location: 'Hanoi',
      profileSkills: [{ id: 1, name: 'Selenium', level: null, sortOrder: 0 }],
    });
    expect(detail.resume).toEqual({
      occupation: '2519.1',
      occupationTitle: expect.any(String),
      years: 4,
      relatedYears: 0.5,
      level: 'Mid',
      jobs: [
        expect.objectContaining({ title: 'QA engineer', start: '2020-01', end: '2024-01' }),
      ],
      degree: 'Bachelor',
      skills: ['Selenium'],
    });
    expect(detail.events[0].actor).toEqual({ id: 7, name: 'Minh' });
  });

  it('the applicant gets it too, as the candidate', async () => {
    const { query } = createQuery();

    const detail = await query.detail(99, candidate);

    expect(detail.viewerRole).toBe('candidate');
    expect(detail.resume).not.toBeNull();
  });

  it('an admin gets it as the recruiter', async () => {
    const { query } = createQuery();

    const detail = await query.detail(99, { id: 1, role: Role.ADMIN });

    expect(detail.viewerRole).toBe('recruiter');
  });

  it('another recruiter gets 403', async () => {
    const { query } = createQuery();

    await expect(
      query.detail(99, { id: 3, role: Role.EMPLOYER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no resume saved: resume is null', async () => {
    const { prisma, query } = createQuery();
    const stored = storedApplication();
    prisma.hiringApplication.findUnique.mockResolvedValue({
      ...stored,
      applicant: { ...stored.applicant, resume: null },
    });

    const detail = await query.detail(99, recruiter);

    expect(detail.resume).toBeNull();
  });
});

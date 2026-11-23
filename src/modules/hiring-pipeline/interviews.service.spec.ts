import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  HiringApplicationStatus,
  HiringPostStatus,
  InterviewMode,
  InterviewStatus,
  Prisma,
} from '@prisma/client';
import { Role } from '../../common/constants/roles';
import { ApplicationPipelineService } from './application-pipeline.service';
import { InterviewsService } from './interviews.service';

const S = HiringApplicationStatus;
const I = InterviewStatus;
const recruiter = { id: 2, role: Role.EMPLOYER };
const candidate = { id: 7, role: Role.USER };

// Fixed "now" so the time checks and the chat text are always the same.
const NOW = new Date('2026-11-23T03:00:00Z');
const WED_25_10 = '2026-11-25T03:00:00.000Z'; // Wed 25 Nov 10:00 in Vietnam (UTC+7)
const THU_26_14 = '2026-11-26T07:00:00.000Z'; // Thu 26 Nov 14:00 in Vietnam

type StoredInterview = {
  id: number;
  applicationId: number;
  round: number;
  mode: InterviewMode;
  durationMinutes: number;
  location: string | null;
  note: string | null;
  proposedTimes: Date[];
  scheduledAt: Date | null;
  status: InterviewStatus;
  rescheduleNote: string | null;
  createdById: number;
  completedAt: Date | null;
  cancelledAt: Date | null;
};

describe('InterviewsService', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function storedInterview(
    overrides: Partial<StoredInterview> = {},
  ): StoredInterview {
    return {
      id: 5,
      applicationId: 99,
      round: 1,
      mode: InterviewMode.ONLINE,
      durationMinutes: 45,
      location: null,
      note: null,
      proposedTimes: [new Date(WED_25_10), new Date(THU_26_14)],
      scheduledAt: null,
      status: I.PROPOSED,
      rescheduleNote: null,
      createdById: 2,
      completedAt: null,
      cancelledAt: null,
      ...overrides,
    };
  }

  /**
   * A small in-memory database: one application and its interviews. The writes change the rows, so a
   * test can run request → accept → complete one after the other.
   */
  function createService(
    options: {
      status?: HiringApplicationStatus;
      postStatus?: HiringPostStatus;
      interviews?: StoredInterview[];
    } = {},
  ) {
    const interviews: StoredInterview[] = options.interviews ?? [];
    const application = {
      id: 99,
      hiringPostId: 10,
      applicantId: 7,
      status: options.status ?? S.REVIEWING,
      statusReason: null,
      hiringPost: {
        id: 10,
        title: 'Senior Test Engineer',
        status: options.postStatus ?? HiringPostStatus.OPEN,
        openings: 1,
        recruiterId: 2,
        recruiter: { name: 'Lan' },
      },
      applicant: { name: 'Minh' },
    };
    const loaded = () => ({
      ...application,
      interviews: interviews.map(({ id, status, round }) => ({
        id,
        status,
        round,
      })),
    });
    const byId = (id: number) => interviews.find((row) => row.id === id);

    const prisma = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $transaction: jest.fn(),
      hiringApplication: {
        findUnique: jest.fn(() => Promise.resolve(loaded())),
        update: jest.fn(({ data }: { data: { status: HiringApplicationStatus } }) => {
          application.status = data.status;
          return Promise.resolve({});
        }),
        count: jest.fn().mockResolvedValue(0),
      },
      interview: {
        findUnique: jest.fn(({ where }: { where: { id: number } }) =>
          Promise.resolve(byId(where.id) ?? null),
        ),
        create: jest.fn(({ data }: { data: Partial<StoredInterview> }) => {
          const row = storedInterview({
            id: 5 + interviews.length,
            ...data,
            status: I.PROPOSED,
          });
          interviews.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn(
          ({ where, data }: { where: { id: number }; data: Partial<StoredInterview> }) => {
            const row = byId(where.id)!;
            Object.assign(row, data);
            return Promise.resolve(row);
          },
        ),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    const events = {
      record: jest.fn().mockResolvedValue(undefined),
      announce: jest.fn().mockResolvedValue(undefined),
    };
    const sweeper = { announceSwept: jest.fn() };
    const query = { detail: jest.fn().mockResolvedValue({ id: 99 }) };
    const pipeline = new ApplicationPipelineService(
      prisma as never,
      events as never,
      sweeper as never,
      query as never,
    );
    const service = new InterviewsService(
      prisma as never,
      events as never,
      pipeline,
    );
    return { prisma, events, query, service, interviews, application };
  }

  const request = (overrides: Record<string, unknown> = {}) => ({
    mode: InterviewMode.ONLINE,
    proposedTimes: [WED_25_10, THU_26_14],
    ...overrides,
  });

  describe('requesting an interview', () => {
    it('creates round 1 PROPOSED, sets INTERVIEWING, writes the event, tells the candidate with a chat message', async () => {
      const { prisma, events, service, application } = createService();

      const result = await service.requestInterview(99, recruiter, request());

      expect(prisma.$queryRaw).toHaveBeenCalled(); // the application row is locked
      expect(prisma.interview.create).toHaveBeenCalledWith({
        data: {
          applicationId: 99,
          round: 1,
          mode: InterviewMode.ONLINE,
          durationMinutes: 45,
          location: null,
          note: null,
          proposedTimes: [new Date(WED_25_10), new Date(THU_26_14)],
          createdById: 2,
        },
      });
      expect(application.status).toBe(S.INTERVIEWING);
      expect(events.record).toHaveBeenCalledWith(prisma, {
        applicationId: 99,
        actorId: 2,
        type: 'interview_requested',
        data: {
          interviewId: 5,
          round: 1,
          mode: InterviewMode.ONLINE,
          proposedTimes: [WED_25_10, THU_26_14],
        },
      });
      expect(events.announce).toHaveBeenCalledWith({
        recipientId: 7,
        actorId: 2,
        kind: 'interview',
        title: 'Interview request',
        body: 'Lan invited you to an interview for Senior Test Engineer. Pick one of the times.',
        applicationId: 99,
        postId: 10,
        postTitle: 'Senior Test Engineer',
        actorName: 'Lan',
        proposedTimes: [WED_25_10, THU_26_14],
        forRecruiter: false,
        chat: 'Interview request for Senior Test Engineer: Wed 25 Nov 10:00, Thu 26 Nov 14:00 (online, 45 min) (Vietnam time)',
        chatBetween: { recruiterId: 2, candidateId: 7 },
      });
      expect(result).toEqual({ message: expect.any(String), content: { id: 99 } });
    });

    it('the next round is the highest round so far + 1', async () => {
      const { prisma, service } = createService({
        status: S.INTERVIEWING,
        interviews: [
          storedInterview({ id: 5, round: 1, status: I.COMPLETED }),
          storedInterview({ id: 6, round: 2, status: I.CANCELLED }),
        ],
      });

      await service.requestInterview(99, recruiter, request());

      expect(prisma.interview.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ round: 3 }),
      });
    });

    it('onsite says the place, phone says "by phone", in the chat message', async () => {
      const onsite = createService();
      await onsite.service.requestInterview(
        99,
        recruiter,
        request({
          mode: InterviewMode.ONSITE,
          location: '12 Le Loi, District 1',
          durationMinutes: 60,
          proposedTimes: [WED_25_10],
        }),
      );
      expect(onsite.events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          chat: 'Interview request for Senior Test Engineer: Wed 25 Nov 10:00 (onsite at 12 Le Loi, District 1, 60 min) (Vietnam time)',
        }),
      );

      const phone = createService();
      await phone.service.requestInterview(
        99,
        recruiter,
        request({ mode: InterviewMode.PHONE, proposedTimes: [WED_25_10] }),
      );
      expect(phone.events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          chat: 'Interview request for Senior Test Engineer: Wed 25 Nov 10:00 (by phone, 45 min) (Vietnam time)',
        }),
      );
    });

    it.each([
      ['no times', []],
      ['4 times', [WED_25_10, THU_26_14, '2026-11-27T03:00:00Z', '2026-11-28T03:00:00Z']],
      ['a time in the past', ['2026-11-22T03:00:00Z']],
      ['a time right now', [NOW.toISOString()]],
      ['the same time twice', [WED_25_10, '2026-11-25T10:00:00+07:00']],
      ['a time that is not a date', ['next tuesday']],
    ])('%s is 400 and nothing is written', async (_name, proposedTimes) => {
      const { prisma, events, service } = createService();

      const error = await service
        .requestInterview(99, recruiter, request({ proposedTimes }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as Error).message).toContain('proposedTimes');
      expect(prisma.interview.create).not.toHaveBeenCalled();
      expect(events.announce).not.toHaveBeenCalled();
    });

    it('onsite without a location is 400', async () => {
      const { prisma, service } = createService();

      await expect(
        service.requestInterview(
          99,
          recruiter,
          request({ mode: InterviewMode.ONSITE, location: '  ' }),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.interview.create).not.toHaveBeenCalled();
    });

    it('a second request while one is active is 409', async () => {
      const { prisma, service } = createService({
        status: S.INTERVIEWING,
        interviews: [storedInterview({ status: I.SCHEDULED })],
      });

      await expect(
        service.requestInterview(99, recruiter, request()),
      ).rejects.toThrow(
        new ConflictException('This application already has an interview in progress.'),
      );
      expect(prisma.interview.create).not.toHaveBeenCalled();
    });

    it('two requests at the same moment: the unique index (P2002) becomes the same 409', async () => {
      const { prisma, events, service } = createService();
      prisma.interview.create.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.requestInterview(99, recruiter, request()),
      ).rejects.toThrow(
        new ConflictException('This application already has an interview in progress.'),
      );
      expect(events.announce).not.toHaveBeenCalled();
    });

    it('the candidate cannot request an interview (403)', async () => {
      const { service } = createService();

      await expect(
        service.requestInterview(99, candidate, request()),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it('the full path request → accept → complete writes 3 events and 3 notifications', async () => {
    const { events, service, interviews, application } = createService();

    await service.requestInterview(99, recruiter, request());
    await service.accept(5, candidate, THU_26_14);
    await service.complete(5, recruiter);

    expect(events.record.mock.calls.map(([, event]) => event.type)).toEqual([
      'interview_requested',
      'interview_booked',
      'interview_completed',
    ]);
    expect(events.announce).toHaveBeenCalledTimes(3);
    expect(events.announce.mock.calls.map(([input]) => input.recipientId)).toEqual([7, 2, 7]);
    expect(interviews[0]).toMatchObject({
      status: I.COMPLETED,
      scheduledAt: new Date(THU_26_14),
      completedAt: NOW,
    });
    expect(application.status).toBe(S.INTERVIEWING);
  });

  describe('accepting a time', () => {
    it('books the time and tells the recruiter', async () => {
      const { prisma, events, service } = createService({
        status: S.INTERVIEWING,
        interviews: [storedInterview()],
      });

      await service.accept(5, candidate, '2026-11-25T10:00:00+07:00');

      expect(prisma.interview.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { status: I.SCHEDULED, scheduledAt: new Date(WED_25_10) },
      });
      expect(events.record).toHaveBeenCalledWith(prisma, {
        applicationId: 99,
        actorId: 7,
        type: 'interview_booked',
        data: { interviewId: 5, scheduledAt: WED_25_10 },
      });
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 2,
          kind: 'interview',
          title: 'Interview booked',
          actorName: 'Minh',
          postTitle: 'Senior Test Engineer',
          scheduledAt: WED_25_10,
          body: 'Minh picked Wed 25 Nov 10:00 (Vietnam time) for the Senior Test Engineer interview.',
          forRecruiter: true,
        }),
      );
    });

    it('a time that was not offered is 400', async () => {
      const { prisma, service } = createService({
        status: S.INTERVIEWING,
        interviews: [storedInterview()],
      });

      await expect(
        service.accept(5, candidate, '2026-11-25T04:00:00Z'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.interview.update).not.toHaveBeenCalled();
    });

    it('an offered time that has passed is 400 "That time has passed."', async () => {
      const { service } = createService({
        status: S.INTERVIEWING,
        interviews: [storedInterview()],
      });
      jest.setSystemTime(new Date('2026-11-25T05:00:00Z'));

      await expect(service.accept(5, candidate, WED_25_10)).rejects.toThrow(
        new BadRequestException('That time has passed. Ask for new times.'),
      );
    });

    it('the recruiter cannot pick the time (403)', async () => {
      const { service } = createService({
        status: S.INTERVIEWING,
        interviews: [storedInterview()],
      });

      await expect(service.accept(5, recruiter, WED_25_10)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('an interview that is already scheduled is 409', async () => {
      const { service } = createService({
        status: S.INTERVIEWING,
        interviews: [storedInterview({ status: I.SCHEDULED })],
      });

      await expect(service.accept(5, candidate, WED_25_10)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  it('asking for other times: RESCHEDULE_REQUESTED with the note, the recruiter is told', async () => {
    const { prisma, events, service } = createService({
      status: S.INTERVIEWING,
      interviews: [storedInterview()],
    });

    await service.requestReschedule(5, candidate, 'Mornings are hard');

    expect(prisma.interview.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: { status: I.RESCHEDULE_REQUESTED, rescheduleNote: 'Mornings are hard' },
    });
    expect(events.record).toHaveBeenCalledWith(prisma, {
      applicationId: 99,
      actorId: 7,
      type: 'interview_reschedule_requested',
      data: { interviewId: 5, note: 'Mornings are hard' },
    });
    expect(events.announce).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 2,
        title: 'Other interview times asked',
        body: 'Minh asked for other interview times for Senior Test Engineer. Mornings are hard',
        forRecruiter: true,
      }),
    );
  });

  it('new times: back to PROPOSED with the new times, the candidate gets a notification and a chat message', async () => {
    const { prisma, events, service } = createService({
      status: S.INTERVIEWING,
      interviews: [
        storedInterview({ status: I.RESCHEDULE_REQUESTED, rescheduleNote: 'Mornings are hard' }),
      ],
    });

    await service.proposeTimes(5, recruiter, [THU_26_14]);

    expect(prisma.interview.update).toHaveBeenCalledWith({
      where: { id: 5 },
      data: {
        status: I.PROPOSED,
        proposedTimes: [new Date(THU_26_14)],
        rescheduleNote: null,
      },
    });
    expect(events.record).toHaveBeenCalledWith(prisma, {
      applicationId: 99,
      actorId: 2,
      type: 'interview_times_proposed',
      data: { interviewId: 5, proposedTimes: [THU_26_14] },
    });
    expect(events.announce).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 7,
        title: 'New interview times',
        proposedTimes: [THU_26_14],
        forRecruiter: false,
        chat: 'New interview times for Senior Test Engineer: Thu 26 Nov 14:00 (online, 45 min) (Vietnam time)',
        chatBetween: { recruiterId: 2, candidateId: 7 },
      }),
    );
  });

  it('new times with a past time are 400', async () => {
    const { service } = createService({
      status: S.INTERVIEWING,
      interviews: [storedInterview({ status: I.RESCHEDULE_REQUESTED })],
    });

    await expect(
      service.proposeTimes(5, recruiter, ['2026-11-01T03:00:00Z']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  describe('cancelling', () => {
    it('the recruiter cancels: CANCELLED, the candidate is told', async () => {
      const { prisma, events, service } = createService({
        status: S.INTERVIEWING,
        interviews: [storedInterview({ status: I.SCHEDULED, scheduledAt: new Date(WED_25_10) })],
      });

      await service.cancel(5, recruiter, 'The role changed');

      expect(prisma.interview.update).toHaveBeenCalledWith({
        where: { id: 5 },
        data: { status: I.CANCELLED, cancelledAt: NOW },
      });
      expect(events.record).toHaveBeenCalledWith(prisma, {
        applicationId: 99,
        actorId: 2,
        type: 'interview_cancelled',
        data: { interviewId: 5, by: 'recruiter', note: 'The role changed' },
      });
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 7,
          title: 'Interview cancelled',
          body: 'The interview for Senior Test Engineer was cancelled. The role changed',
          forRecruiter: false,
        }),
      );
    });

    it('the candidate cancels: the recruiter is told', async () => {
      const { events, service } = createService({
        status: S.INTERVIEWING,
        interviews: [storedInterview({ status: I.SCHEDULED })],
      });

      await service.cancel(5, candidate);

      expect(events.record).toHaveBeenCalledWith(expect.anything(), {
        applicationId: 99,
        actorId: 7,
        type: 'interview_cancelled',
        data: { interviewId: 5, by: 'candidate' },
      });
      expect(events.announce).toHaveBeenCalledWith(
        expect.objectContaining({ recipientId: 2, forRecruiter: true }),
      );
    });

    it('a finished interview cannot be cancelled (409)', async () => {
      const { service } = createService({
        status: S.INTERVIEWING,
        interviews: [storedInterview({ status: I.COMPLETED })],
      });

      await expect(service.cancel(5, recruiter)).rejects.toThrow(
        new ConflictException('This interview was already completed.'),
      );
    });
  });

  it('complete needs a scheduled interview (409 otherwise) and the recruiter (403 otherwise)', async () => {
    const proposed = createService({
      status: S.INTERVIEWING,
      interviews: [storedInterview()],
    });
    await expect(proposed.service.complete(5, recruiter)).rejects.toBeInstanceOf(
      ConflictException,
    );

    const scheduled = createService({
      status: S.INTERVIEWING,
      interviews: [storedInterview({ status: I.SCHEDULED })],
    });
    await expect(scheduled.service.complete(5, candidate)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('a stranger gets 403 on an interview action and nothing is written', async () => {
    const { prisma, events, service } = createService({
      status: S.INTERVIEWING,
      interviews: [storedInterview()],
    });

    await expect(
      service.cancel(5, { id: 3, role: Role.EMPLOYER }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.interview.update).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it('an interview action on a closed post is 409 and nothing is written', async () => {
    const { prisma, events, service } = createService({
      status: S.INTERVIEWING,
      postStatus: HiringPostStatus.CLOSED,
      interviews: [storedInterview()],
    });

    await expect(
      service.accept(5, candidate, '2026-11-25T10:00:00+07:00'),
    ).rejects.toThrow('This hiring post is closed.');
    expect(prisma.interview.update).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it('the applicant of a different application cannot accept this interview (403, nothing written)', async () => {
    const { prisma, events, service } = createService({
      status: S.INTERVIEWING,
      interviews: [storedInterview()],
    });

    await expect(
      service.accept(5, { id: 8, role: Role.USER }, '2026-11-25T10:00:00+07:00'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.interview.update).not.toHaveBeenCalled();
    expect(events.record).not.toHaveBeenCalled();
  });

  it('an interview that does not exist is 404', async () => {
    const { service } = createService();

    await expect(service.complete(404, recruiter)).rejects.toThrow(
      'Interview with ID 404 not found',
    );
  });

  describe('upcoming', () => {
    function row(overrides: { applicantId: number; recruiterId: number }) {
      return {
        ...storedInterview({ status: I.SCHEDULED, scheduledAt: new Date(WED_25_10) }),
        application: {
          id: 99,
          applicantId: overrides.applicantId,
          applicant: { id: overrides.applicantId, name: 'Minh', avatar: 'minh.png' },
          hiringPost: {
            id: 10,
            title: 'Senior Test Engineer',
            companyName: 'Acme',
            recruiterId: overrides.recruiterId,
            recruiter: { id: overrides.recruiterId, name: 'Lan', avatar: null },
          },
        },
      };
    }

    it('asks only for the viewer\'s scheduled interviews from 2 hours ago, soonest first, max 20', async () => {
      const { prisma, service } = createService();

      await service.upcoming(candidate);

      expect(prisma.interview.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: I.SCHEDULED,
            scheduledAt: { gte: new Date('2026-11-23T01:00:00Z') },
            application: {
              OR: [{ applicantId: 7 }, { hiringPost: { recruiterId: 7 } }],
            },
          },
          orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
          take: 20,
        }),
      );
    });

    it('the other person is the recruiter for the candidate and the applicant for the recruiter', async () => {
      const { prisma, service } = createService();
      prisma.interview.findMany.mockResolvedValue([row({ applicantId: 7, recruiterId: 2 })]);

      const asCandidate = await service.upcoming(candidate);
      const asRecruiter = await service.upcoming(recruiter);

      expect(asCandidate.content[0]).toMatchObject({
        id: 5,
        status: I.SCHEDULED,
        applicationId: 99,
        post: { id: 10, title: 'Senior Test Engineer', companyName: 'Acme' },
        otherPerson: { id: 2, name: 'Lan', avatar: null },
        viewerRole: 'candidate',
      });
      expect(asCandidate.content[0]).not.toHaveProperty('application');
      expect(asRecruiter.content[0]).toMatchObject({
        otherPerson: { id: 7, name: 'Minh', avatar: 'minh.png' },
        viewerRole: 'recruiter',
      });
    });
  });
});

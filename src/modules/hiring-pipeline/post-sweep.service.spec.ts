import { HiringApplicationStatus, InterviewStatus } from '@prisma/client';
import { PostSweepService } from './post-sweep.service';

describe('PostSweepService', () => {
  // A small fake of the transaction client (tx): findMany honours the
  // `status: { in: [...] }` filter, so the test shows which rows the sweep picks.
  function fakeTx() {
    const applications = [
      { id: 1, applicantId: 11, status: HiringApplicationStatus.APPLIED },
      { id: 2, applicantId: 12, status: HiringApplicationStatus.INTERVIEWING },
      { id: 3, applicantId: 13, status: HiringApplicationStatus.HIRED },
      { id: 4, applicantId: 14, status: HiringApplicationStatus.WITHDRAWN },
    ];
    const interviews = [
      { id: 50, applicationId: 2, status: InterviewStatus.SCHEDULED },
      { id: 51, applicationId: 2, status: InterviewStatus.COMPLETED },
    ];
    const inList = (status: string, where: { status?: { in: string[] } }) =>
      !where.status || where.status.in.includes(status);
    return {
      // The row lock (SELECT ... FOR UPDATE) of the active applications.
      $queryRaw: jest.fn().mockResolvedValue([]),
      hiringApplication: {
        findMany: jest.fn(
          ({ where }: { where: { status?: { in: string[] } } }) =>
            Promise.resolve(
              applications.filter((row) => inList(row.status, where)),
            ),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      interview: {
        findMany: jest.fn(
          ({
            where,
          }: {
            where: {
              applicationId: { in: number[] };
              status: { in: string[] };
            };
          }) =>
            Promise.resolve(
              interviews.filter(
                (row) =>
                  where.applicationId.in.includes(row.applicationId) &&
                  inList(row.status, where),
              ),
            ),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
  }

  function createService() {
    const events = {
      record: jest.fn().mockResolvedValue(undefined),
      recordMany: jest.fn().mockResolvedValue(undefined),
    };
    return { events, service: new PostSweepService(events as never) };
  }

  it('rejects the 2 active applications and leaves HIRED and WITHDRAWN alone', async () => {
    const { service, events } = createService();
    const tx = fakeTx();

    const candidates = await service.sweep(tx as never, 8, 'POST_CLOSED', 2);

    expect(candidates).toEqual([11, 12]);
    expect(tx.hiringApplication.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [1, 2] },
        status: {
          in: [
            HiringApplicationStatus.APPLIED,
            HiringApplicationStatus.REVIEWING,
            HiringApplicationStatus.INTERVIEWING,
            HiringApplicationStatus.OFFERED,
          ],
        },
      },
      data: {
        status: HiringApplicationStatus.REJECTED,
        statusReason: 'POST_CLOSED',
        statusNote: null,
      },
    });
    // One write (createMany) for all the rejected rows; nothing for HIRED (3) or WITHDRAWN (4).
    expect(events.record).not.toHaveBeenCalled();
    expect(events.recordMany).toHaveBeenCalledWith(tx, [
      {
        applicationId: 1,
        actorId: 2,
        type: 'rejected',
        data: { reason: 'POST_CLOSED' },
      },
      {
        applicationId: 2,
        actorId: 2,
        type: 'rejected',
        data: { reason: 'POST_CLOSED' },
      },
    ]);
  });

  it('locks the active applications before reading them, so a withdraw at the same time waits', async () => {
    const { service } = createService();
    const tx = fakeTx();
    const order: string[] = [];
    tx.$queryRaw.mockImplementation(() => {
      order.push('lock');
      return Promise.resolve([]);
    });
    const read = tx.hiringApplication.findMany.getMockImplementation()!;
    tx.hiringApplication.findMany.mockImplementation((args) => {
      order.push('read');
      return read(args);
    });

    await service.sweep(tx as never, 8, 'POST_CLOSED', 2);

    expect(order).toEqual(['lock', 'read']);
    const sql = (tx.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).toContain('"hiring_applications"');
    expect(sql).toContain('FOR UPDATE');
    expect(tx.$queryRaw.mock.calls[0]).toContain(8);
  });

  it('cancels only the active interviews of the swept applications', async () => {
    const { service, events } = createService();
    const tx = fakeTx();

    await service.sweep(tx as never, 8, 'POSITION_FILLED', 2);

    expect(tx.interview.updateMany).toHaveBeenCalledWith({
      where: {
        id: { in: [50] },
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
    // One write per kind: the rejected rows, then the cancelled interviews.
    expect(events.recordMany).toHaveBeenCalledTimes(2);
    expect(events.recordMany).toHaveBeenLastCalledWith(tx, [
      {
        applicationId: 2,
        actorId: 2,
        type: 'interview_cancelled',
        data: { interviewId: 50, by: 'system', reason: 'POSITION_FILLED' },
      },
    ]);
  });

  it('does nothing when no application is active', async () => {
    const { service, events } = createService();
    const tx = fakeTx();
    tx.hiringApplication.findMany.mockResolvedValue([]);

    await expect(service.sweep(tx as never, 8, 'POST_CLOSED', 2)).resolves.toEqual([]);
    expect(tx.hiringApplication.updateMany).not.toHaveBeenCalled();
    expect(tx.interview.findMany).not.toHaveBeenCalled();
    expect(events.recordMany).not.toHaveBeenCalled();
  });

  it('tells each swept candidate after commit, in plain English', async () => {
    const prisma = {
      hiringApplication: {
        findMany: jest.fn().mockResolvedValue([
          { id: 1, applicantId: 11 },
          { id: 2, applicantId: 12 },
        ]),
      },
    };
    const announcer = { announce: jest.fn().mockResolvedValue(undefined) };
    const sweeper = new PostSweepService(announcer as never);

    await sweeper.announceSwept(prisma as never, {
      postId: 8,
      postTitle: 'Senior Test Engineer',
      reason: 'POSITION_FILLED',
      actorId: 2,
      actorName: 'Lan',
      candidateIds: [11, 12],
    });

    expect(prisma.hiringApplication.findMany).toHaveBeenCalledWith({
      where: { hiringPostId: 8, applicantId: { in: [11, 12] } },
      select: { id: true, applicantId: true },
    });
    expect(announcer.announce).toHaveBeenCalledTimes(2);
    expect(announcer.announce).toHaveBeenCalledWith({
      recipientId: 11,
      actorId: 2,
      kind: 'application',
      title: 'Position filled',
      body: 'The Senior Test Engineer role has been filled. Thank you for applying.',
      applicationId: 1,
      postId: 8,
      postTitle: 'Senior Test Engineer',
      actorName: 'Lan',
      forRecruiter: false,
    });
  });

  it('says the post is closed for a manual close, and skips an empty list', async () => {
    const prisma = {
      hiringApplication: {
        findMany: jest.fn().mockResolvedValue([{ id: 1, applicantId: 11 }]),
      },
    };
    const announcer = { announce: jest.fn().mockResolvedValue(undefined) };
    const sweeper = new PostSweepService(announcer as never);

    await sweeper.announceSwept(prisma as never, {
      postId: 8,
      postTitle: 'Senior Test Engineer',
      reason: 'POST_CLOSED',
      actorId: 2,
      actorName: 'Lan',
      candidateIds: [],
    });
    expect(prisma.hiringApplication.findMany).not.toHaveBeenCalled();

    await sweeper.announceSwept(prisma as never, {
      postId: 8,
      postTitle: 'Senior Test Engineer',
      reason: 'POST_CLOSED',
      actorId: 2,
      actorName: 'Lan',
      candidateIds: [11],
    });
    expect(announcer.announce).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Post closed',
        body: 'The Senior Test Engineer post is closed.',
      }),
    );
  });
});

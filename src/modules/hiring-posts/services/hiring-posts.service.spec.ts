import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { HiringApplicationStatus, HiringPostStatus } from '@prisma/client';
import { Role } from '../../../common/constants/roles';
import { HiringPostsService } from './hiring-posts.service';

describe('HiringPostsService', () => {
  const now = new Date('2026-07-19T00:00:00.000Z');

  const openPost = {
    id: 10,
    recruiterId: 2,
    title: 'Security Analyst',
    description: 'Monitor alerts and respond to incidents',
    requirements: 'SIEM, incident response',
    location: 'Remote',
    employmentType: 'Full-time',
    salaryMin: 50000,
    salaryMax: 70000,
    predictedSeniority: null,
    predictedSeniorityConfidence: null,
    predictedSeniorityModel: null,
    predictedSeniorityMetadata: null,
    predictedSeniorityAt: null,
    companyName: null,
    occupationCode: '2529.6',
    specialty: null,
    legacyField: null,
    yearsRequired: 3,
    skills: ['SIEM'],
    closesAt: null,
    status: HiringPostStatus.OPEN,
    createdAt: now,
    updatedAt: now,
    recruiter: {
      id: 2,
      name: 'Recruiter',
      avatar: null,
      headline: 'Talent lead',
    },
    _count: { applications: 0 },
  };

  function createService() {
    const prisma = {
      hiringPost: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $queryRaw: jest.fn().mockResolvedValue([]),
      // The transaction mock runs the callback with this same mock as `tx`.
      $transaction: jest.fn(),
      hiringApplication: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    prisma.$transaction.mockImplementation(
      (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    );
    const aiQueue = {
      kick: jest.fn(),
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const events = {
      record: jest.fn().mockResolvedValue(undefined),
      announce: jest.fn().mockResolvedValue(undefined),
    };
    const sweeper = {
      sweep: jest.fn().mockResolvedValue([]),
      announceSwept: jest.fn().mockResolvedValue(undefined),
    };

    return {
      prisma,
      aiQueue,
      events,
      sweeper,
      service: new HiringPostsService(
        prisma as never,
        aiQueue as never,
        events as never,
        sweeper as never,
      ),
    };
  }

  function applicationCard(overrides: Record<string, unknown> = {}) {
    return {
      id: 99,
      hiringPostId: openPost.id,
      applicantId: 7,
      coverLetter: 'I can help with SOC operations.',
      status: HiringApplicationStatus.APPLIED,
      createdAt: now,
      updatedAt: now,
      hiringPost: openPost,
      applicant: {
        id: 7,
        name: 'Candidate',
        avatar: null,
        headline: 'SOC Analyst',
        bio: 'Incident response and SIEM',
        location: 'Remote',
        profileSkills: [],
      },
      ...overrides,
    };
  }

  it('creates an application for an open post when the user has not applied', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue(openPost);
    prisma.hiringApplication.findUnique.mockResolvedValue(null);
    prisma.hiringApplication.create.mockResolvedValue(applicationCard());

    const result = await service.apply(openPost.id, 7, {
      coverLetter: '  I can help with SOC operations.  ',
    });

    expect(prisma.hiringApplication.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          hiringPostId: openPost.id,
          applicantId: 7,
          coverLetter: 'I can help with SOC operations.',
        },
      }),
    );
    expect(result.content).toMatchObject({
      id: 99,
      hiringPost: { id: openPost.id, applicationCount: 0 },
    });
  });

  it('shows an open post to a visitor who is not signed in', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue(openPost);

    const result = await service.findOne(openPost.id);

    expect(result.content).toMatchObject({ id: openPost.id, viewerHasApplied: false });
  });

  it('a visitor who is not signed in gets viewerApplication: null and no application query', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue(openPost);

    const result = await service.findOne(openPost.id);

    expect(result.content.viewerApplication).toBeNull();
    expect(prisma.hiringApplication.findMany).not.toHaveBeenCalled();
  });

  it('the list gives each card the viewer own application from ONE query, null for posts not applied to', async () => {
    const { prisma, service } = createService();
    const posts = [10, 11, 12].map((id) => ({ ...openPost, id }));
    prisma.hiringPost.findMany.mockResolvedValue(posts);
    prisma.hiringPost.count.mockResolvedValue(3);
    prisma.hiringApplication.findMany.mockResolvedValue([
      {
        id: 55,
        hiringPostId: 10,
        status: HiringApplicationStatus.REJECTED,
        statusReason: 'POSITION_FILLED',
      },
      {
        id: 56,
        hiringPostId: 11,
        status: HiringApplicationStatus.WITHDRAWN,
        statusReason: null,
      },
    ]);

    const result = await service.findOpen({}, 7);

    expect(prisma.hiringApplication.findMany).toHaveBeenCalledTimes(1);
    const [first, second, third] = result.content.data;
    expect(first.viewerApplication).toEqual({
      id: 55,
      status: HiringApplicationStatus.REJECTED,
      statusReason: 'POSITION_FILLED',
    });
    expect(first.viewerHasApplied).toBe(true);
    // Withdrawn: the application is shown, but the viewer may apply again.
    expect(second.viewerApplication).toEqual({
      id: 56,
      status: HiringApplicationStatus.WITHDRAWN,
      statusReason: null,
    });
    expect(second.viewerHasApplied).toBe(false);
    expect(third.viewerApplication).toBeNull();
    expect(third.viewerHasApplied).toBe(false);
  });

  it('the detail card and the apply card carry the viewer application; an unknown statusReason becomes null', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue(openPost);
    prisma.hiringApplication.findMany.mockResolvedValue([
      {
        id: 55,
        hiringPostId: openPost.id,
        status: HiringApplicationStatus.REVIEWING,
        statusReason: 'something else',
      },
    ]);

    const detail = await service.findOne(openPost.id, 7, Role.USER);
    expect(detail.content.viewerApplication).toEqual({
      id: 55,
      status: HiringApplicationStatus.REVIEWING,
      statusReason: null,
    });

    prisma.hiringApplication.findUnique.mockResolvedValue(null);
    prisma.hiringApplication.create.mockResolvedValue(applicationCard());
    const applied = await service.apply(openPost.id, 7, {});
    expect(applied.content.hiringPost.viewerApplication).toEqual({
      id: 99,
      status: HiringApplicationStatus.APPLIED,
      statusReason: null,
    });
  });

  it('hides a closed post from a visitor', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue({
      ...openPost,
      status: HiringPostStatus.CLOSED,
    });

    await expect(service.findOne(openPost.id)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('lists only posts that are open and not past their closing date, with filters', async () => {
    const { prisma, service } = createService();

    await service.findOpen({
      page: 1,
      pageSize: 10,
      occupation: ['2512.3'],
      level: ['Mid'],
      location: 'Hanoi',
    });

    const where = prisma.hiringPost.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { status: HiringPostStatus.OPEN },
        { OR: [{ closesAt: null }, { closesAt: { gt: expect.any(Date) } }] },
        { occupationCode: { in: ['2512.3'] } },
        { predictedSeniority: { in: ['Mid'] } },
        { location: { contains: 'Hanoi', mode: 'insensitive' } },
      ]),
    );
  });

  it('saves the structured fields of a new post', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.create.mockResolvedValue(openPost);

    await service.create(
      {
        title: 'Security Analyst',
        description: 'Monitor alerts and respond to incidents quickly',
        occupationCode: ' 2529.6 ',
        specialty: ' Application Security Analyst ',
        yearsRequired: 3,
        skills: ['SIEM'],
        companyName: ' Acme ',
      },
      2,
    );

    expect(prisma.hiringPost.create.mock.calls[0][0].data).toMatchObject({
      companyName: 'Acme',
      occupationCode: '2529.6',
      specialty: 'Application Security Analyst',
      yearsRequired: 3,
      skills: ['SIEM'],
      closesAt: null,
    });
  });

  describe('occupation and specialty', () => {
    const newPost = {
      title: 'Security Analyst',
      description: 'Monitor alerts and respond to incidents quickly',
      occupationCode: '2529.6',
      yearsRequired: 3,
    };

    it('rejects an unknown occupation code with 400', async () => {
      const { prisma, service } = createService();
      await expect(
        service.create({ ...newPost, occupationCode: '9999.99' }, 2),
      ).rejects.toMatchObject({ status: 400, message: 'Choose the occupation from the list.' });
      expect(prisma.hiringPost.create).not.toHaveBeenCalled();
    });

    it('rejects a specialty that is not listed under the occupation with 400', async () => {
      const { prisma, service } = createService();
      await expect(
        service.create({ ...newPost, specialty: '.NET Programmer' }, 2),
      ).rejects.toMatchObject({ status: 400, message: 'Choose a specialty listed under the occupation.' });
      expect(prisma.hiringPost.create).not.toHaveBeenCalled();
    });

    it('checks a new specialty against the occupation the post already has', async () => {
      const { prisma, service } = createService();
      prisma.hiringPost.findUnique.mockResolvedValue(openPost);
      await expect(
        service.update(openPost.id, { specialty: '.NET Programmer' }, 2, Role.EMPLOYER),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.hiringPost.update).not.toHaveBeenCalled();
    });

    it('a new occupation clears the AI level, requeues, and drops the stored specialty when none is sent', async () => {
      const { prisma, service, aiQueue } = createService();
      prisma.hiringPost.findUnique.mockResolvedValue({
        ...openPost,
        specialty: 'Application Security Analyst',
        predictedSeniority: 'Mid',
      });
      prisma.hiringPost.update.mockResolvedValue(openPost);

      await service.update(openPost.id, { occupationCode: '2512.3' }, 2, Role.EMPLOYER);

      expect(prisma.hiringPost.update.mock.calls[0][0].data).toMatchObject({
        occupationCode: '2512.3',
        specialty: null,
        predictedSeniority: null,
        aiStatus: 'QUEUED',
      });
      expect(aiQueue.kick).toHaveBeenCalled();
    });

    it('an old post without an occupation saves other edits and keeps its legacy field', async () => {
      const { prisma, service } = createService();
      prisma.hiringPost.findUnique.mockResolvedValue({
        ...openPost,
        occupationCode: null,
        legacyField: 'IT and security',
      });
      prisma.hiringPost.update.mockResolvedValue(openPost);

      await service.update(openPost.id, { location: 'Hanoi', specialty: '' }, 2, Role.EMPLOYER);

      const data = prisma.hiringPost.update.mock.calls[0][0].data;
      expect(data).toMatchObject({ location: 'Hanoi' });
      expect(data).not.toHaveProperty('occupationCode');
      expect(data).not.toHaveProperty('legacyField');
    });

    it('rejects an unknown occupation filter with 400', async () => {
      const { service } = createService();
      await expect(service.findOpen({ occupation: ['9999.99'] })).rejects.toMatchObject({ status: 400 });
    });

    it('shows the occupation title on the post card', async () => {
      const { prisma, service } = createService();
      prisma.hiringPost.findUnique.mockResolvedValue(openPost);
      const result = await service.findOne(openPost.id, 2, Role.EMPLOYER);
      expect(result.content).toMatchObject({
        occupationCode: '2529.6',
        occupationTitle: 'ICT security consultant',
      });
    });
  });

  describe('list search, sort, locations and facets', () => {
    it('counts at most 100 pages but keeps the real total', async () => {
      const { prisma, service } = createService();
      prisma.hiringPost.count.mockResolvedValue(5_000);

      const result = await service.findOpen({ page: 1, pageSize: 10 });

      expect(result.content).toMatchObject({ totalRow: 5_000, totalPages: 100 });
    });

    it('searches the company name and, ignoring case, the skills', async () => {
      const { prisma, service } = createService();
      prisma.$queryRaw.mockResolvedValue([{ id: 10 }, { id: 12 }]);

      await service.findOpen({ keyword: 'selenium' });

      const keyword = prisma.hiringPost.findMany.mock.calls[0][0].where.AND[2];
      expect(keyword.OR).toEqual(
        expect.arrayContaining([
          { companyName: { contains: 'selenium', mode: 'insensitive' } },
          { id: { in: [10, 12] } },
        ]),
      );
      expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual(['%selenium%']);
    });

    it('escapes LIKE wildcards in the skill search', async () => {
      const { prisma, service } = createService();
      await service.findOpen({ keyword: '100%_c\\' });
      expect(prisma.$queryRaw.mock.calls[0].slice(1)).toEqual([
        '%100\\%\\_c\\\\%',
      ]);
    });

    it.each([
      [undefined, [{ updatedAt: 'desc' }, { id: 'desc' }]],
      [
        'closing_soon',
        [{ closesAt: { sort: 'asc', nulls: 'last' } }, { id: 'desc' }],
      ],
      [
        'salary_high',
        [
          { salaryMax: { sort: 'desc', nulls: 'last' } },
          { salaryMin: { sort: 'desc', nulls: 'last' } },
          { id: 'desc' },
        ],
      ],
    ] as const)(
      'orders by sort=%s, always ending with id',
      async (sort, orderBy) => {
        const { prisma, service } = createService();
        await service.findOpen({ sort });
        expect(prisma.hiringPost.findMany.mock.calls[0][0].orderBy).toEqual(
          orderBy,
        );
      },
    );

    it('ORs values inside a filter and ANDs the filters', async () => {
      const { prisma, service } = createService();
      await service.findOpen({
        level: ['Junior', 'Mid'],
        employmentType: ['Full-time', 'Internship'],
      });
      expect(prisma.hiringPost.findMany.mock.calls[0][0].where.AND).toEqual(
        expect.arrayContaining([
          { predictedSeniority: { in: ['Junior', 'Mid'] } },
          {
            OR: [
              { employmentType: { equals: 'Full-time', mode: 'insensitive' } },
              { employmentType: { equals: 'Internship', mode: 'insensitive' } },
            ],
          },
        ]),
      );
    });

    it('names the unknown occupation codes in the 400', async () => {
      const { service } = createService();
      await expect(
        service.findOpen({ occupation: ['2512.3', '9999.99'] }),
      ).rejects.toThrow(/Unknown occupation: 9999\.99/);
    });

    it('merges location spellings and counts what ?location= would find', async () => {
      const { prisma, service } = createService();
      prisma.hiringPost.groupBy.mockResolvedValue([
        { location: 'Da Nang', _count: { _all: 4 } },
        { location: ' da nang ', _count: { _all: 1 } },
        { location: 'Da Nang, Vietnam', _count: { _all: 2 } },
        { location: 'Remote - APAC', _count: { _all: 3 } },
      ]);

      const result = await service.findLocations();

      expect(result.content).toEqual([
        { value: 'Da Nang', count: 7 },
        { value: 'Remote - APAC', count: 3 },
        { value: 'Da Nang, Vietnam', count: 2 },
      ]);
      const where = prisma.hiringPost.groupBy.mock.calls[0][0].where;
      expect(JSON.stringify(where)).toContain('"status":"OPEN"');
    });

    it('counts each facet with every filter but its own', async () => {
      const { prisma, service } = createService();
      prisma.hiringPost.groupBy.mockImplementation(
        ({ by }: { by: string[] }) => {
          if (by[0] === 'occupationCode') {
            return Promise.resolve([
              { occupationCode: '2512.3', _count: { _all: 9 } },
              { occupationCode: 'nope', _count: { _all: 50 } },
            ]);
          }
          if (by[0] === 'predictedSeniority') {
            return Promise.resolve([
              { predictedSeniority: 'Senior', _count: { _all: 9 } },
              { predictedSeniority: 'Mid', _count: { _all: 6 } },
              { predictedSeniority: null, _count: { _all: 2 } },
            ]);
          }
          if (by[0] === 'employmentType') {
            return Promise.resolve([
              { employmentType: 'Full-time', _count: { _all: 10 } },
              { employmentType: 'full-time', _count: { _all: 4 } },
              { employmentType: null, _count: { _all: 1 } },
            ]);
          }
          return Promise.resolve([]);
        },
      );

      const result = await service.findFacets({
        level: ['Senior'],
        employmentType: ['Full-time'],
      });

      expect(result.content.occupations).toEqual([
        { code: '2512.3', title: expect.any(String), count: 9 },
      ]);
      expect(result.content.levels).toEqual([
        { value: 'Junior', count: 0 },
        { value: 'Mid', count: 6 },
        { value: 'Senior', count: 9 },
      ]);
      expect(result.content.employmentTypes).toEqual([
        { value: 'Full-time', count: 14 },
      ]);

      const whereFor = (field: string) =>
        JSON.stringify(
          prisma.hiringPost.groupBy.mock.calls.find(
            ([args]: [{ by: string[] }]) => args.by[0] === field,
          )![0].where,
        );
      expect(whereFor('predictedSeniority')).not.toContain('predictedSeniority');
      expect(whereFor('predictedSeniority')).toContain('Full-time');
      expect(whereFor('employmentType')).toContain('Senior');
      expect(whereFor('employmentType')).not.toContain('Full-time');
    });
  });

  it('rejects a closing date in the past', async () => {
    const { service } = createService();
    await expect(
      service.create(
        {
          title: 'Security Analyst',
          description: 'Monitor alerts and respond to incidents quickly',
          occupationCode: '2529.6',
          yearsRequired: 3,
          closesAt: '2020-01-01T00:00:00.000Z',
        },
        2,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('clears the AI level when the required years change', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue({ ...openPost, predictedSeniority: 'Mid' });
    prisma.hiringPost.update.mockResolvedValue(openPost);

    await service.update(openPost.id, { yearsRequired: 6 }, 2, Role.EMPLOYER);

    expect(prisma.hiringPost.update.mock.calls[0][0].data).toMatchObject({
      yearsRequired: 6,
      predictedSeniority: null,
    });
  });

  it('keeps the AI level when only the description changes', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue({ ...openPost, predictedSeniority: 'Mid' });
    prisma.hiringPost.update.mockResolvedValue(openPost);

    await service.update(openPost.id, { description: 'A clearer description of the role' }, 2, Role.EMPLOYER);

    expect(prisma.hiringPost.update.mock.calls[0][0].data).not.toHaveProperty('predictedSeniority');
  });

  it('rejects applications to closed hiring posts', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue({
      ...openPost,
      status: HiringPostStatus.CLOSED,
    });

    await expect(service.apply(openPost.id, 7, {})).rejects.toThrow(
      new ConflictException('This hiring post is closed.'),
    );
    expect(prisma.hiringApplication.findUnique).not.toHaveBeenCalled();
  });

  it('apply waits for the post lock (FOR SHARE) and refuses when the post closed meanwhile', async () => {
    const { prisma, service } = createService();
    // First read (before the transaction): OPEN. Read again after the lock: CLOSED.
    prisma.hiringPost.findUnique
      .mockResolvedValueOnce(openPost)
      .mockResolvedValueOnce({ status: HiringPostStatus.CLOSED, closesAt: null });
    prisma.hiringApplication.findUnique.mockResolvedValue(null);

    await expect(service.apply(openPost.id, 7, {})).rejects.toThrow(
      new ConflictException('This hiring post is closed.'),
    );
    const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
    expect(sql).toContain('FROM "hiring_posts"');
    expect(sql).toContain('FOR SHARE');
    expect(prisma.hiringApplication.create).not.toHaveBeenCalled();
  });

  it('apply refuses a post past its closing date with 409', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue({
      ...openPost,
      closesAt: new Date(Date.now() - 1000),
    });
    prisma.hiringApplication.findUnique.mockResolvedValue(null);

    await expect(service.apply(openPost.id, 7, {})).rejects.toThrow(
      new ConflictException('This hiring post is closed.'),
    );
    expect(prisma.hiringApplication.create).not.toHaveBeenCalled();
  });

  it('the applicant sees viewerHasApplied: true on the card apply returns and on applications/me', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue(openPost);
    prisma.hiringApplication.findUnique.mockResolvedValue(null);
    prisma.hiringApplication.create.mockResolvedValue(applicationCard());

    const applied = await service.apply(openPost.id, 7, {});
    expect(applied.content.hiringPost.viewerHasApplied).toBe(true);

    prisma.hiringApplication.findMany.mockResolvedValue([
      applicationCard(),
      applicationCard({
        id: 100,
        hiringPostId: 11,
        hiringPost: { ...openPost, id: 11 },
        status: HiringApplicationStatus.WITHDRAWN,
      }),
    ]);
    prisma.hiringApplication.count.mockResolvedValue(2);
    const mine = await service.findMyApplications(7, {});
    expect(mine.content.data[0].hiringPost.viewerHasApplied).toBe(true);
    // A withdrawn application can be sent again, so the post does not count as applied.
    expect(mine.content.data[1].hiringPost.viewerHasApplied).toBe(false);
  });

  it('rejects applications to a user own hiring post', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue(openPost);

    await expect(service.apply(openPost.id, openPost.recruiterId, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.hiringApplication.findUnique).not.toHaveBeenCalled();
  });

  it('rejects duplicate active applications', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue(openPost);
    prisma.hiringApplication.findUnique.mockResolvedValue({
      id: 99,
      status: HiringApplicationStatus.APPLIED,
    });

    await expect(service.apply(openPost.id, 7, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.hiringApplication.create).not.toHaveBeenCalled();
    expect(prisma.hiringApplication.update).not.toHaveBeenCalled();
  });

  it('allows a withdrawn application to be submitted again', async () => {
    const { prisma, service } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue(openPost);
    prisma.hiringApplication.findUnique.mockResolvedValue({
      id: 99,
      status: HiringApplicationStatus.WITHDRAWN,
    });
    prisma.hiringApplication.update.mockResolvedValue(
      applicationCard({ coverLetter: 'Available again.' }),
    );

    const result = await service.apply(openPost.id, 7, {
      coverLetter: 'Available again.',
    });

    expect(prisma.hiringApplication.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 99 },
        data: {
          coverLetter: 'Available again.',
          status: HiringApplicationStatus.APPLIED,
          statusReason: null,
          statusNote: null,
          offerNote: null,
          offeredAt: null,
          decidedAt: null,
        },
      }),
    );
    expect(result.content).toMatchObject({
      id: 99,
      coverLetter: 'Available again.',
      status: HiringApplicationStatus.APPLIED,
    });
  });

  it('queues a post for its AI level instead of waiting for the AI', async () => {
    const { prisma, service, aiQueue } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue(openPost);

    const result = await service.predictSeniority(openPost.id, 2, Role.EMPLOYER);

    expect(aiQueue.enqueue).toHaveBeenCalledWith(openPost.id);
    expect(result.message).toBe('Hiring post queued for AI evaluation');
  });

  it('queues a new post for its AI level', async () => {
    const { prisma, service, aiQueue } = createService();
    prisma.hiringPost.create.mockResolvedValue(openPost);

    await service.create(
      {
        title: 'Security Analyst',
        description: 'Monitor alerts and respond to incidents quickly',
        occupationCode: '2529.6',
        yearsRequired: 3,
      },
      2,
    );

    expect(prisma.hiringPost.create.mock.calls[0][0].data).toMatchObject({
      aiStatus: 'QUEUED',
      aiQueuedAt: expect.any(Date),
    });
    expect(aiQueue.kick).toHaveBeenCalled();
  });

  it('queues again when the description changes, but keeps the current level', async () => {
    const { prisma, service, aiQueue } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue({ ...openPost, predictedSeniority: 'Mid' });
    prisma.hiringPost.update.mockResolvedValue(openPost);

    await service.update(openPost.id, { description: 'Lead the incident response team and mentor two analysts' }, 2, Role.EMPLOYER);

    const data = prisma.hiringPost.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ aiStatus: 'QUEUED' });
    expect(data).not.toHaveProperty('predictedSeniority');
    expect(aiQueue.kick).toHaveBeenCalled();
  });

  it('does not queue when only the location changes', async () => {
    const { prisma, service, aiQueue } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue(openPost);
    prisma.hiringPost.update.mockResolvedValue(openPost);

    await service.update(openPost.id, { location: 'Hanoi' }, 2, Role.EMPLOYER);

    expect(prisma.hiringPost.update.mock.calls[0][0].data).not.toHaveProperty('aiStatus');
    expect(aiQueue.kick).not.toHaveBeenCalled();
  });

  describe('openings, sweep on close and the new-applicant notification', () => {
    const newPost = {
      title: 'Security Analyst',
      description: 'Monitor alerts and respond to incidents quickly',
      occupationCode: '2529.6',
      yearsRequired: 3,
    };

    it('stores openings: 1 when not sent, the number sent, and null kept', async () => {
      const { prisma, service } = createService();
      prisma.hiringPost.create.mockResolvedValue({ ...openPost, openings: 1 });

      await service.create(newPost, 2);
      await service.create({ ...newPost, openings: 4 }, 2);
      await service.create({ ...newPost, openings: null }, 2);

      expect(prisma.hiringPost.create.mock.calls[0][0].data.openings).toBe(1);
      expect(prisma.hiringPost.create.mock.calls[1][0].data.openings).toBe(4);
      expect(prisma.hiringPost.create.mock.calls[2][0].data.openings).toBeNull();
    });

    it('closing an open post sweeps it in the same transaction, then tells the candidates', async () => {
      const { prisma, service, sweeper } = createService();
      prisma.hiringPost.findUnique.mockResolvedValue(openPost);
      prisma.hiringPost.update.mockResolvedValue({
        ...openPost,
        status: HiringPostStatus.CLOSED,
      });
      sweeper.sweep.mockResolvedValue([7, 8]);

      await service.update(
        openPost.id,
        { status: HiringPostStatus.CLOSED },
        2,
        Role.EMPLOYER,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      // The close is claimed only while the post is still OPEN.
      expect(prisma.hiringPost.updateMany).toHaveBeenCalledWith({
        where: { id: openPost.id, status: HiringPostStatus.OPEN },
        data: { status: HiringPostStatus.CLOSED },
      });
      expect(sweeper.sweep).toHaveBeenCalledWith(
        prisma,
        openPost.id,
        'POST_CLOSED',
        2,
      );
      expect(sweeper.announceSwept).toHaveBeenCalledWith(prisma, {
        postId: openPost.id,
        postTitle: openPost.title,
        reason: 'POST_CLOSED',
        actorId: 2,
        actorName: 'Recruiter',
        candidateIds: [7, 8],
      });
    });

    it('does not sweep when another request closed the post first', async () => {
      const { prisma, service, sweeper } = createService();
      prisma.hiringPost.findUnique.mockResolvedValue(openPost);
      prisma.hiringPost.updateMany.mockResolvedValue({ count: 0 });
      prisma.hiringPost.update.mockResolvedValue({
        ...openPost,
        status: HiringPostStatus.CLOSED,
      });

      await service.update(
        openPost.id,
        { status: HiringPostStatus.CLOSED },
        2,
        Role.EMPLOYER,
      );

      expect(sweeper.sweep).not.toHaveBeenCalled();
      expect(sweeper.announceSwept).not.toHaveBeenCalled();
    });

    it('editing or reopening a closed post does not sweep or change applications', async () => {
      const { prisma, service, sweeper } = createService();
      const closedPost = { ...openPost, status: HiringPostStatus.CLOSED };
      prisma.hiringPost.findUnique.mockResolvedValue(closedPost);
      prisma.hiringPost.update.mockResolvedValue(openPost);

      await service.update(
        openPost.id,
        { status: HiringPostStatus.CLOSED, location: 'Hanoi' },
        2,
        Role.EMPLOYER,
      );
      await service.update(
        openPost.id,
        { status: HiringPostStatus.OPEN },
        2,
        Role.EMPLOYER,
      );

      expect(prisma.hiringPost.updateMany).not.toHaveBeenCalled();
      expect(sweeper.sweep).not.toHaveBeenCalled();
      expect(sweeper.announceSwept).not.toHaveBeenCalled();
      expect(prisma.hiringApplication.update).not.toHaveBeenCalled();
    });

    describe('editing openings', () => {
      /** The post the update reads after the lock, and how many people are HIRED / OFFERED. */
      function setup(
        locked: { status: HiringPostStatus; openings: number | null },
        hired: number,
        offered: number,
      ) {
        const created = createService();
        const { prisma } = created;
        prisma.hiringPost.findUnique
          .mockResolvedValueOnce({ ...openPost, ...locked })
          .mockResolvedValue(locked);
        prisma.hiringApplication.count.mockImplementation(
          ({ where }: { where: { status: HiringApplicationStatus } }) =>
            Promise.resolve(
              where.status === HiringApplicationStatus.HIRED ? hired : offered,
            ),
        );
        prisma.hiringPost.update.mockResolvedValue({ ...openPost, ...locked });
        return created;
      }

      it('locks the post row first (FOR UPDATE) before counting', async () => {
        const { prisma, service } = setup(
          { status: HiringPostStatus.OPEN, openings: 2 },
          0,
          0,
        );

        await service.update(openPost.id, { openings: 5 }, 2, Role.EMPLOYER);

        const sql = prisma.$queryRaw.mock.calls[0][0].join('?');
        expect(sql).toContain('FROM "hiring_posts"');
        expect(sql).toContain('FOR UPDATE');
        expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
          prisma.hiringApplication.count.mock.invocationCallOrder[0],
        );
        expect(prisma.hiringPost.update.mock.calls[0][0].data.openings).toBe(5);
      });

      it('refuses fewer openings than people hired or with an offer waiting (409)', async () => {
        const { prisma, service, sweeper } = setup(
          { status: HiringPostStatus.OPEN, openings: 5 },
          2,
          1,
        );

        await expect(
          service.update(openPost.id, { openings: 2 }, 2, Role.EMPLOYER),
        ).rejects.toThrow(
          new ConflictException(
            '3 people are hired or have an offer waiting, so openings cannot be fewer than 3.',
          ),
        );
        expect(prisma.hiringPost.update).not.toHaveBeenCalled();
        expect(sweeper.sweep).not.toHaveBeenCalled();
      });

      it('says "1 person is" when one person is taken', async () => {
        const { service } = setup(
          { status: HiringPostStatus.OPEN, openings: 2 },
          0,
          1,
        );

        // 0 cannot pass the DTO (at least 1), but the service check still has to hold.
        await expect(
          service.update(openPost.id, { openings: 0 }, 2, Role.EMPLOYER),
        ).rejects.toThrow(
          new ConflictException(
            '1 person is hired or has an offer waiting, so openings cannot be fewer than 1.',
          ),
        );
      });

      it('openings: null (no limit) is always allowed and never closes the post', async () => {
        const { prisma, service, sweeper } = setup(
          { status: HiringPostStatus.OPEN, openings: 2 },
          2,
          0,
        );

        await service.update(openPost.id, { openings: null }, 2, Role.EMPLOYER);

        expect(sweeper.sweep).not.toHaveBeenCalled();
        expect(prisma.hiringPost.update.mock.calls[0][0].data.openings).toBeNull();
      });

      it('openings equal to the hires (no offers waiting) closes an open post and sweeps it as filled', async () => {
        const { prisma, service, sweeper } = setup(
          { status: HiringPostStatus.OPEN, openings: 5 },
          2,
          0,
        );
        sweeper.sweep.mockResolvedValue([7]);

        await service.update(openPost.id, { openings: 2 }, 2, Role.EMPLOYER);

        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(sweeper.sweep).toHaveBeenCalledWith(
          prisma,
          openPost.id,
          'POSITION_FILLED',
          2,
        );
        expect(prisma.hiringPost.update.mock.calls.at(-1)[0].data).toMatchObject({
          openings: 2,
          status: HiringPostStatus.CLOSED,
        });
        expect(sweeper.announceSwept).toHaveBeenCalledWith(prisma, {
          postId: openPost.id,
          postTitle: openPost.title,
          reason: 'POSITION_FILLED',
          actorId: 2,
          actorName: 'Recruiter',
          candidateIds: [7],
        });
      });

      it('raising openings above the hires does not close or sweep', async () => {
        const { prisma, service, sweeper } = setup(
          { status: HiringPostStatus.OPEN, openings: 2 },
          2,
          0,
        );

        await service.update(openPost.id, { openings: 3 }, 2, Role.EMPLOYER);

        expect(sweeper.sweep).not.toHaveBeenCalled();
        expect(prisma.hiringPost.update.mock.calls[0][0].data).not.toHaveProperty(
          'status',
        );
      });

      it('refuses to reopen a filled post (409) unless the openings are raised', async () => {
        const { prisma, service } = setup(
          { status: HiringPostStatus.CLOSED, openings: 2 },
          2,
          0,
        );

        await expect(
          service.update(
            openPost.id,
            { status: HiringPostStatus.OPEN },
            2,
            Role.EMPLOYER,
          ),
        ).rejects.toThrow(
          new ConflictException(
            'This post is already filled. Raise the openings to reopen it.',
          ),
        );
        expect(prisma.hiringPost.update).not.toHaveBeenCalled();

        const raised = setup({ status: HiringPostStatus.CLOSED, openings: 2 }, 2, 0);
        await raised.service.update(
          openPost.id,
          { status: HiringPostStatus.OPEN, openings: 3 },
          2,
          Role.EMPLOYER,
        );
        expect(raised.prisma.hiringPost.update.mock.calls[0][0].data).toMatchObject({
          status: HiringPostStatus.OPEN,
          openings: 3,
        });
      });
    });

    it('apply records an applied event and tells the recruiter', async () => {
      const { prisma, service, events } = createService();
      prisma.hiringPost.findUnique.mockResolvedValue(openPost);
      prisma.hiringApplication.findUnique.mockResolvedValue(null);
      prisma.hiringApplication.create.mockResolvedValue(applicationCard());

      await service.apply(openPost.id, 7, { coverLetter: 'Hello' });

      expect(events.record).toHaveBeenCalledWith(prisma, {
        applicationId: 99,
        actorId: 7,
        type: 'applied',
      });
      expect(events.announce).toHaveBeenCalledWith({
        recipientId: openPost.recruiterId,
        actorId: 7,
        kind: 'received',
        title: 'New applicant',
        body: 'Candidate applied for Security Analyst.',
        applicationId: 99,
        postId: openPost.id,
        postTitle: 'Security Analyst',
        actorName: 'Candidate',
        forRecruiter: true,
      });
    });

    it('re-applying after a withdrawal records a reapplied event', async () => {
      const { prisma, service, events } = createService();
      prisma.hiringPost.findUnique.mockResolvedValue(openPost);
      prisma.hiringApplication.findUnique.mockResolvedValue({
        id: 99,
        status: HiringApplicationStatus.WITHDRAWN,
      });
      prisma.hiringApplication.update.mockResolvedValue(applicationCard());

      await service.apply(openPost.id, 7, {});

      expect(events.record).toHaveBeenCalledWith(prisma, {
        applicationId: 99,
        actorId: 7,
        type: 'reapplied',
      });
      expect(events.announce).toHaveBeenCalledTimes(1);
    });

    it('the owner list has pipeline counts from one groupBy, with every key', async () => {
      const { prisma, service } = createService();
      prisma.hiringPost.findMany.mockResolvedValue([
        { ...openPost, openings: 3 },
        { ...openPost, id: 11 },
      ]);
      prisma.hiringPost.count.mockResolvedValue(2);
      prisma.hiringApplication.groupBy.mockResolvedValue([
        { hiringPostId: 10, status: 'APPLIED', _count: { _all: 4 } },
        { hiringPostId: 10, status: 'OFFERED', _count: { _all: 1 } },
        { hiringPostId: 10, status: 'HIRED', _count: { _all: 2 } },
      ]);

      const result = await service.findMine(2, Role.EMPLOYER, {});

      expect(prisma.hiringApplication.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.hiringApplication.groupBy.mock.calls[0][0]).toMatchObject({
        by: ['hiringPostId', 'status'],
        where: { hiringPostId: { in: [10, 11] } },
      });
      expect(result.content.data[0]).toMatchObject({
        openings: 3,
        hiredCount: 2,
        offersWaiting: 1,
        pipeline: { APPLIED: 4, REVIEWING: 0, INTERVIEWING: 0, OFFERED: 1, HIRED: 2 },
      });
      expect(result.content.data[1]).toMatchObject({
        hiredCount: 0,
        offersWaiting: 0,
        pipeline: { APPLIED: 0, REVIEWING: 0, INTERVIEWING: 0, OFFERED: 0, HIRED: 0 },
      });
    });

    it('public cards show hired and waiting offers but not the pipeline', async () => {
      const { prisma, service } = createService();
      prisma.hiringPost.findMany.mockResolvedValue([openPost]);
      prisma.hiringPost.count.mockResolvedValue(1);
      prisma.hiringApplication.groupBy.mockResolvedValue([
        { hiringPostId: 10, status: 'HIRED', _count: { _all: 1 } },
      ]);

      const result = await service.findOpen({});

      expect(prisma.hiringApplication.groupBy).toHaveBeenCalledTimes(1);
      expect(result.content.data[0]).toMatchObject({ hiredCount: 1, offersWaiting: 0 });
      expect(result.content.data[0]).not.toHaveProperty('pipeline');
    });
  });
  describe('applications of a post (recruiter pipeline page)', () => {
    it('filters by status and returns the count of every status from one groupBy', async () => {
      const { prisma, service } = createService();
      prisma.hiringPost.findUnique.mockResolvedValue(openPost);
      prisma.hiringApplication.findMany.mockResolvedValue([
        applicationCard({ status: HiringApplicationStatus.REVIEWING }),
      ]);
      prisma.hiringApplication.count.mockResolvedValue(1);
      prisma.hiringApplication.groupBy.mockResolvedValue([
        { status: 'APPLIED', _count: { _all: 3 } },
        { status: 'REVIEWING', _count: { _all: 1 } },
        { status: 'HIRED', _count: { _all: 2 } },
        { status: 'WITHDRAWN', _count: { _all: 1 } },
      ]);

      const result = await service.findApplicationsForPost(
        openPost.id,
        2,
        Role.EMPLOYER,
        { page: 1, pageSize: 10, status: HiringApplicationStatus.REVIEWING },
      );

      expect(prisma.hiringApplication.findMany.mock.calls[0][0].where).toEqual({
        hiringPostId: openPost.id,
        status: HiringApplicationStatus.REVIEWING,
      });
      expect(prisma.hiringApplication.count).toHaveBeenCalledWith({
        where: { hiringPostId: openPost.id, status: HiringApplicationStatus.REVIEWING },
      });
      expect(prisma.hiringApplication.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.hiringApplication.groupBy).toHaveBeenCalledWith({
        by: ['status'],
        where: { hiringPostId: openPost.id },
        _count: { _all: true },
      });
      expect(result.content.counts).toEqual({
        APPLIED: 3,
        REVIEWING: 1,
        INTERVIEWING: 0,
        OFFERED: 0,
        HIRED: 2,
        REJECTED: 0,
        DECLINED: 0,
        WITHDRAWN: 1,
      });
      expect(result.content.data[0].hiringPost).toMatchObject({ hiredCount: 2, offersWaiting: 0 });
      expect(result.content.total).toBe(1);
    });

    it('gives each row the resume summary and the interviews (by round) from the same findMany', async () => {
      const { prisma, service } = createService();
      prisma.hiringPost.findUnique.mockResolvedValue(openPost);
      const interview = {
        id: 5,
        applicationId: 99,
        round: 1,
        scheduledAt: now,
      };
      prisma.hiringApplication.findMany.mockResolvedValue([
        applicationCard({
          applicant: {
            ...applicationCard().applicant,
            profileSkills: [
              { id: 1, name: 'SIEM', level: null, sortOrder: 0 },
            ],
            resume: {
              data: { Occupation: '2519.1', Jobs: [] },
              predictedSeniority: 'Mid',
              predictedSeniorityMetadata: {
                features: { years_in_occupation: 4, related_years: 0.5 },
              },
            },
          },
          interviews: [interview],
        }),
        applicationCard({
          id: 100,
          applicant: { ...applicationCard().applicant, resume: null },
          interviews: [],
        }),
      ]);
      prisma.hiringApplication.count.mockResolvedValue(2);
      prisma.hiringApplication.groupBy.mockResolvedValue([]);

      const result = await service.findApplicationsForPost(
        openPost.id,
        2,
        Role.EMPLOYER,
        {},
      );

      const include = prisma.hiringApplication.findMany.mock.calls[0][0].include;
      expect(include.interviews).toEqual({ orderBy: { round: 'asc' } });
      expect(include.applicant.select.resume.select).toMatchObject({
        data: true,
        predictedSeniority: true,
        predictedSeniorityMetadata: true,
      });
      expect(include.events).toBeUndefined();
      const [first, second] = result.content.data;
      expect(first.resume).toMatchObject({
        occupation: '2519.1',
        years: 4,
        relatedYears: 0.5,
        level: 'Mid',
        skills: ['SIEM'],
      });
      expect(first.interviews).toEqual([interview]);
      expect(first.applicant).not.toHaveProperty('resume');
      expect(first.applicant.bio).toBe('Incident response and SIEM');
      expect(second.resume).toBeNull();
      expect(second.interviews).toEqual([]);
    });

    it('my applications rows carry interviews (by round) from the same findMany, no resume or events', async () => {
      const { prisma, service } = createService();
      const interview = { id: 5, applicationId: 99, round: 1, status: 'PROPOSED' };
      prisma.hiringApplication.findMany.mockResolvedValue([
        applicationCard({ interviews: [interview] }),
      ]);
      prisma.hiringApplication.count.mockResolvedValue(1);

      const result = await service.findMyApplications(7, {});

      const include = prisma.hiringApplication.findMany.mock.calls[0][0].include;
      expect(include.interviews).toEqual({ orderBy: { round: 'asc' } });
      expect(include.events).toBeUndefined();
      expect(include.applicant.select.resume).toBeUndefined();
      expect(result.content.data[0].interviews).toEqual([interview]);
    });

    it('lists every status when no filter is given', async () => {
      const { prisma, service } = createService();
      prisma.hiringPost.findUnique.mockResolvedValue(openPost);

      await service.findApplicationsForPost(openPost.id, 2, Role.EMPLOYER, {});

      expect(prisma.hiringApplication.findMany.mock.calls[0][0].where).toEqual({
        hiringPostId: openPost.id,
      });
    });
  });
});

import { BadRequestException, ForbiddenException } from '@nestjs/common';
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
    careerField: 'Information security',
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
        create: jest.fn(),
        update: jest.fn(),
      },
      hiringApplication: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    const aiClient = {
      predictJobSeniority: jest.fn(),
    };
    const payloadMapper = {
      buildHiringPostPayload: jest.fn((post) => ({
        id: post.id,
        job_title: post.title,
      })),
    };

    return {
      prisma,
      aiClient,
      payloadMapper,
      service: new HiringPostsService(
        prisma as never,
        aiClient as never,
        payloadMapper as never,
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
      careerField: 'Software development',
      level: 'Mid',
      location: 'Hanoi',
    });

    const where = prisma.hiringPost.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { status: HiringPostStatus.OPEN },
        { OR: [{ closesAt: null }, { closesAt: { gt: expect.any(Date) } }] },
        { careerField: 'Software development' },
        { predictedSeniority: 'Mid' },
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
        careerField: 'Information security',
        yearsRequired: 3,
        skills: ['SIEM'],
        companyName: ' Acme ',
      },
      2,
    );

    expect(prisma.hiringPost.create.mock.calls[0][0].data).toMatchObject({
      companyName: 'Acme',
      careerField: 'Information security',
      yearsRequired: 3,
      skills: ['SIEM'],
      closesAt: null,
    });
  });

  it('rejects a closing date in the past', async () => {
    const { service } = createService();
    await expect(
      service.create(
        {
          title: 'Security Analyst',
          description: 'Monitor alerts and respond to incidents quickly',
          careerField: 'Information security',
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

    await expect(service.apply(openPost.id, 7, {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.hiringApplication.findUnique).not.toHaveBeenCalled();
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
        },
      }),
    );
    expect(result.content).toMatchObject({
      id: 99,
      coverLetter: 'Available again.',
      status: HiringApplicationStatus.APPLIED,
    });
  });

  it('predicts and saves hiring post seniority', async () => {
    const { prisma, service, aiClient, payloadMapper } = createService();
    prisma.hiringPost.findUnique.mockResolvedValue(openPost);
    aiClient.predictJobSeniority.mockResolvedValue({
      label: 'Mid',
      confidence: 0.72,
      probabilities: { Junior: 0.1, Mid: 0.72, Senior: 0.18 },
      features: { job_title: 'Security Analyst' },
      model: 'jobaura-recruiter-classifier',
      elapsed_ms: 8,
    });
    prisma.hiringPost.update.mockResolvedValue({
      ...openPost,
      predictedSeniority: 'Mid',
      predictedSeniorityConfidence: 0.72,
      predictedSeniorityModel: 'jobaura-recruiter-classifier',
      predictedSeniorityMetadata: {
        probabilities: { Junior: 0.1, Mid: 0.72, Senior: 0.18 },
        features: { job_title: 'Security Analyst' },
        elapsedMs: 8,
      },
      predictedSeniorityAt: now,
    });

    const result = await service.predictSeniority(
      openPost.id,
      2,
      Role.EMPLOYER,
    );

    expect(payloadMapper.buildHiringPostPayload).toHaveBeenCalledWith(openPost);
    expect(aiClient.predictJobSeniority).toHaveBeenCalledWith({
      job: { id: openPost.id, job_title: openPost.title },
    });
    expect(prisma.hiringPost.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: openPost.id },
        data: expect.objectContaining({
          predictedSeniority: 'Mid',
          predictedSeniorityConfidence: 0.72,
          predictedSeniorityModel: 'jobaura-recruiter-classifier',
          predictedSeniorityAt: expect.any(Date),
        }),
      }),
    );
    expect(result.content).toMatchObject({
      id: openPost.id,
      predictedSeniority: 'Mid',
      predictedSeniorityConfidence: 0.72,
    });
  });
});

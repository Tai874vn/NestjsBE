import { Role } from '../../../common/constants/roles';
import {
  CandidateDirectoryService,
  candidateCareer,
} from './candidate-directory.service';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';

describe('CandidateDirectoryService', () => {
  const createService = () => {
    const prisma = {
      user: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };
    const profileNormalizer = new UserProfileNormalizerService();
    const service = new CandidateDirectoryService(
      prisma as never,
      profileNormalizer,
    );

    return { service, prisma };
  };

  it('filters by field, AI level and minimum years from the resume', async () => {
    const { service, prisma } = createService();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await service.findCandidates({
      careerField: 'Software development',
      level: 'Mid',
      minYears: 3,
    });

    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([
      {
        resume: {
          is: { data: { path: ['Industry'], equals: 'Software development' } },
        },
      },
      { resume: { is: { predictedSeniority: 'Mid' } } },
      {
        resume: {
          is: {
            predictedSeniorityMetadata: {
              path: ['features', 'years_in_field'],
              gte: 3,
            },
          },
        },
      },
    ]);
  });

  it('shows the field, AI level and years in field on each card', async () => {
    const { service, prisma } = createService();
    prisma.user.findMany.mockResolvedValue([
      {
        id: 4,
        name: 'Ava',
        resume: {
          data: { Industry: 'Data' },
          predictedSeniority: 'Senior',
          predictedSeniorityMetadata: { features: { years_in_field: 6.5 } },
        },
      },
      { id: 5, name: 'Ben', resume: null },
    ]);
    prisma.user.count.mockResolvedValue(2);

    const result = await service.findCandidates({});

    const byId = new Map(result.content.data.map((card) => [card.id, card]));
    expect(byId.get(4)?.career).toEqual({
      careerField: 'Data',
      level: 'Senior',
      yearsInField: 6.5,
    });
    expect(byId.get(5)?.career).toBeNull();
  });

  it('paginates candidate rows in the database', async () => {
    const { service, prisma } = createService();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await service.findCandidates({ page: 3, pageSize: 10 });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });

  it('returns paginated directory cards from completed, discoverable worker profiles only', async () => {
    const { service, prisma } = createService();
    const updatedAt = new Date('2026-06-01T00:00:00.000Z');

    prisma.user.count.mockResolvedValue(2);
    prisma.user.findMany.mockResolvedValue([
      {
        id: 10,
        name: 'Lina Tran',
        email: 'private@example.com',
        phone: '+85511111111',
        role: Role.USER,
        avatar: 'https://example.com/avatar.png',
        headline: 'Senior Backend Engineer',
        bio: 'Builds Python API platforms',
        location: 'Remote',
        skill: JSON.stringify(['Python', 'FastAPI']),
        profileCompleted: true,
        updatedAt,
        profileSkills: [
          { id: 1, name: 'Python', level: 'advanced', sortOrder: 0 },
          { id: 2, name: 'FastAPI', level: null, sortOrder: 1 },
        ],
        _count: { profileCertifications: 1, portfolioItems: 2, jobs: 1 },
        resume: { data: { Text: 'Raw private resume text' } },
      },
      {
        id: 11,
        name: 'Mei Chen',
        email: 'mei@example.com',
        phone: '+85522222222',
        role: Role.USER,
        avatar: null,
        headline: 'Data Analyst',
        bio: 'SQL reporting',
        location: 'Phnom Penh',
        skill: JSON.stringify(['SQL']),
        profileCompleted: true,
        updatedAt,
        profileSkills: [{ id: 3, name: 'SQL', level: null, sortOrder: 0 }],
        _count: { profileCertifications: 0, portfolioItems: 0, jobs: 0 },
        resume: null,
      },
    ]);

    const result = await service.findCandidates({
      page: 1,
      pageSize: 10,
      keyword: 'backend',
      skill: 'Python',
      location: 'Remote',
    });

    expect(prisma.user.count).toHaveBeenCalledWith({
      where: expect.objectContaining({
        role: Role.USER,
        candidateDiscoverable: true,
      }),
    });
    // Visibility is the candidate's own switch; an incomplete profile is still listed.
    expect(prisma.user.count.mock.calls[0][0].where).not.toHaveProperty('profileCompleted');
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: Role.USER,
          candidateDiscoverable: true,
        }),
      }),
    );
    expect(result.content).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 2,
      totalPages: 1,
    });
    expect(result.content.data[0]).toMatchObject({
      id: 10,
      name: 'Lina Tran',
      headline: 'Senior Backend Engineer',
      profileSkills: [
        expect.objectContaining({ name: 'Python' }),
        expect.objectContaining({ name: 'FastAPI' }),
      ],
      stats: {
        portfolioItems: 2,
        certifications: 1,
        listedServices: 1,
        completedWork: 0,
        rating: 0,
      },
      match: expect.objectContaining({
        label: 'high_match',
      }),
    });
    expect(result.content.data[0]).not.toHaveProperty('email');
    expect(result.content.data[0]).not.toHaveProperty('phone');
    expect(result.content.data[0]).not.toHaveProperty('resume');
  });
});

describe('candidateCareer with a cleared level', () => {
  it('shows no level and no years for a resume whose level was cleared', () => {
    expect(
      candidateCareer({
        data: { Occupation: '', LegacyField: 'QA' },
        predictedSeniority: null,
        predictedSeniorityMetadata: null,
      }),
    ).toEqual({ careerField: null, level: null, yearsInField: null });
  });
});

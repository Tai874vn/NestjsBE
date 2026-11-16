import { Role } from '../../../common/constants/roles';
import {
  CandidateDirectoryService,
  candidateCareer,
} from './candidate-directory.service';
import { findOccupation } from '../../occupations/occupation-catalogue';
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

  it('filters by occupation, AI level and minimum years in the occupation', async () => {
    const { service, prisma } = createService();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);

    await service.findCandidates({
      occupation: '2513.5',
      level: 'Mid',
      minYears: 3,
    });

    const where = prisma.user.findMany.mock.calls[0][0].where;
    expect(where.AND).toEqual([
      {
        resume: {
          is: { OR: [{ data: { path: ['Occupation'], equals: '2513.5' } }] },
        },
      },
      { resume: { is: { predictedSeniority: 'Mid' } } },
      {
        resume: {
          is: {
            predictedSeniorityMetadata: {
              path: ['features', 'years_in_occupation'],
              gte: 3,
            },
          },
        },
      },
    ]);
  });

  it('shows the occupation, specialty, years in it and related years separately on each card', async () => {
    const { service, prisma } = createService();
    const specialty = findOccupation('2513.5')!.specialties[0];
    prisma.user.findMany.mockResolvedValue([
      {
        id: 4,
        name: 'Ava',
        resume: {
          data: {
            Occupation: '2513.5',
            Specialty: specialty,
            Jobs: [
              // 3 years as a web developer, 2 as a software developer (relatedness 0.538).
              { title: 'Web developer', occupation: '2513.5', start: '2020-01', end: '2022-12' },
              { title: 'Developer', occupation: '2512.3', start: '2023-01', end: '2024-12' },
            ],
          },
          predictedSeniority: 'Mid',
          predictedSeniorityMetadata: { features: { years_in_occupation: 3 } },
        },
      },
      { id: 5, name: 'Ben', resume: null },
    ]);
    prisma.user.count.mockResolvedValue(2);

    const result = await service.findCandidates({});

    const byId = new Map(result.content.data.map((card) => [card.id, card]));
    expect(byId.get(4)?.career).toEqual({
      occupationCode: '2513.5',
      occupationTitle: 'web developer',
      specialty,
      yearsInOccupation: 3,
      relatedYears: 0.3,
      level: 'Mid',
      legacyField: null,
    });
    expect(byId.get(5)?.career).toBeNull();
  });

  describe('occupation filter', () => {
    // A candidate is returned when the where clause's main-occupation condition accepts their resume.
    const candidates = [
      { id: 1, name: 'Web', resume: { data: { Occupation: '2513.5' } } },
      { id: 2, name: 'Software', resume: { data: { Occupation: '2512.3' } } },
      { id: 3, name: 'Data', resume: { data: { Occupation: '2511.3' } } },
    ];
    type OccupationWhere = {
      AND?: Array<{
        resume?: { is?: { OR?: Array<{ data: { equals: string } }> } };
      }>;
    };
    const found = async (query: { occupation: string; includeRelated?: boolean }) => {
      const { service, prisma } = createService();
      prisma.user.findMany.mockImplementation(({ where }: { where: OccupationWhere }) => {
        const codes = (where.AND ?? [])
          .flatMap((filter) => filter.resume?.is?.OR ?? [])
          .map((condition) => condition.data.equals);
        return Promise.resolve(
          candidates.filter((c) => codes.includes(c.resume.data.Occupation)),
        );
      });
      prisma.user.count.mockResolvedValue(0);
      const result = await service.findCandidates(query);
      return result.content.data.map((card) => card.career?.occupationCode);
    };

    it('2512.3 is in the related list of 2513.5 in the synced catalogue, and 2511.3 is not', () => {
      const related = findOccupation('2513.5')!.related.map((r) => r.code);
      expect(related).toContain('2512.3');
      expect(related).not.toContain('2511.3');
    });

    it('with includeRelated, a filter by 2513.5 finds a 2512.3 candidate', async () => {
      const codes = await found({ occupation: '2513.5', includeRelated: true });
      expect(codes).toContain('2512.3');
      expect(codes).toContain('2513.5');
      expect(codes).not.toContain('2511.3');
    });

    it('without includeRelated, a filter by 2513.5 finds only the main occupation, no 2511.3 candidate', async () => {
      const codes = await found({ occupation: '2513.5' });
      expect(codes).toEqual(['2513.5']);
      expect(codes).not.toContain('2511.3');
    });

    it('rejects an unknown occupation code with 400', async () => {
      await expect(found({ occupation: '9999.99' })).rejects.toMatchObject({ status: 400 });
    });
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
    ).toEqual({
      occupationCode: null,
      occupationTitle: null,
      specialty: null,
      yearsInOccupation: null,
      relatedYears: null,
      level: null,
      legacyField: 'QA',
    });
  });
});

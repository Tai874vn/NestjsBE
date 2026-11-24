import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ProfileCompletionService } from './profile-completion.service';
import { UserLegacyProfileSyncService } from './user-legacy-profile-sync.service';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';
import { UserProfileService } from './user-profile.service';

describe('UserProfileService', () => {
  const createService = () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      userCertification: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
      userSkill: {
        deleteMany: jest.fn(),
        createMany: jest.fn(),
        findMany: jest.fn(),
      },
      userResume: { count: jest.fn(() => Promise.resolve(0)) },
      comment: {
        aggregate: jest.fn(),
      },
      contract: {
        count: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    const redisService = {
      get: jest.fn(),
      set: jest.fn(),
      invalidateUserCaches: jest.fn(),
    };

    const profileNormalizer = new UserProfileNormalizerService();
    const profileCompletionService = new ProfileCompletionService(
      prisma as any,
    );
    const legacyProfileSyncService = new UserLegacyProfileSyncService(
      prisma as any,
    );
    // Stands in for the AI service dictionary: any spelling of React resolves to it; "Reakt" is unknown.
    const skillService = {
      requireKnownSkills: jest.fn((names: string[]) => {
        const unknown = names.filter((name) => name === 'Reakt');
        if (unknown.length) {
          throw new BadRequestException(
            `Choose skills from the list. Not recognised: ${unknown.join(', ')}`,
          );
        }
        return names.map((name) =>
          ['react', 'reactjs', 'react.js'].includes(name.toLowerCase())
            ? { id: 'onet:react', name: 'React' }
            : { id: `skill:${name.toLowerCase()}`, name },
        );
      }),
    };
    const resumeAiQueue = { enqueue: jest.fn() };
    const service = new UserProfileService(
      prisma as any,
      redisService as any,
      profileCompletionService,
      legacyProfileSyncService,
      profileNormalizer,
      skillService as any,
      resumeAiQueue as any,
    );

    return { service, prisma, redisService, skillService, resumeAiQueue };
  };

  it('rejects duplicate profile certifications case-insensitively', async () => {
    const { service, prisma } = createService();

    await expect(
      service.replaceProfileCertifications(1, {
        certifications: [
          { name: 'AWS Certified Developer', issuer: 'AWS' },
          { name: ' aws certified developer ', issuer: 'AWS' },
        ],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns a public profile without legacy or internal count fields', async () => {
    const { service, prisma, redisService } = createService();
    const createdAt = new Date('2026-01-01T00:00:00.000Z');

    redisService.get.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      name: 'Jane Doe',
      avatar: 'https://example.com/avatar.png',
      coverImage: 'https://example.com/cover.png',
      headline: 'Backend Developer',
      bio: 'Builds APIs',
      location: 'Bangkok',
      website: 'https://example.com',
      profileCompleted: true,
      profileSkills: [],
      profileCertifications: [],
      portfolioItems: [],
      skill: JSON.stringify(['NestJS']),
      certification: JSON.stringify(['AWS']),
      createdAt,
      jobs: [],
      _count: {
        jobs: 2,
        comments: 3,
      },
    });
    prisma.comment.aggregate.mockResolvedValue({
      _avg: { rating: 4.5 },
      _count: { rating: 6 },
    });
    prisma.contract.count.mockResolvedValue(1);

    const result = await service.getPublicProfile(1);

    // completedHires counts COMPLETED contracts where the user is the freelancer.
    expect(prisma.contract.count).toHaveBeenCalledWith({
      where: { status: 'COMPLETED', freelancerId: 1 },
    });
    expect(result.content).toMatchObject({
      id: 1,
      profileSkills: [expect.objectContaining({ name: 'NestJS' })],
      profileCertifications: [expect.objectContaining({ name: 'AWS' })],
      stats: {
        totalJobs: 2,
        totalComments: 6,
        averageRating: 4.5,
        completedHires: 1,
      },
    });
    expect(result.content).not.toHaveProperty('skill');
    expect(result.content).not.toHaveProperty('certification');
    expect(result.content).not.toHaveProperty('_count');
  });

  it('returns cached public profiles without querying the database', async () => {
    const { service, prisma, redisService } = createService();
    const cachedProfile = {
      message: 'Get public profile successfully',
      content: { id: 1, name: 'Cached User' },
    };

    redisService.get.mockResolvedValue(cachedProfile);

    await expect(service.getPublicProfile(1)).resolves.toBe(cachedProfile);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.comment.aggregate).not.toHaveBeenCalled();
    expect(prisma.contract.count).not.toHaveBeenCalled();
  });

  it('keeps profile completion false until the current required profile fields exist', async () => {
    const { service, prisma, redisService } = createService();

    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({
        name: 'Jane Doe',
        avatar: 'https://example.com/avatar.png',
        headline: 'Backend Developer',
        bio: 'Builds APIs',
        profileSkills: [],
      });
    prisma.user.update
      .mockResolvedValueOnce({
        id: 1,
        name: 'Jane Doe',
        avatar: 'https://example.com/avatar.png',
        headline: 'Backend Developer',
        bio: 'Builds APIs',
        profileCompleted: true,
      })
      .mockResolvedValueOnce({ profileCompleted: false });

    const result = await service.uploadAvatar(
      1,
      'https://example.com/avatar.png',
    );

    expect(result.content.profileCompleted).toBe(false);
    expect(prisma.user.update).toHaveBeenLastCalledWith({
      where: { id: 1 },
      data: { profileCompleted: false },
    });
    expect(redisService.invalidateUserCaches).toHaveBeenCalledWith(1);
  });

  it('returns my profile with normalized skills and without legacy profile strings', async () => {
    const { service, prisma } = createService();

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      name: 'Jane Doe',
      email: 'jane@example.com',
      phone: null,
      birthDay: null,
      gender: null,
      role: 'user',
      skill: JSON.stringify(['["React"]', 'NestJS']),
      certification: JSON.stringify(['AWS']),
      headline: 'Fullstack Developer',
      bio: 'Builds products',
      location: 'Bangkok',
      website: 'https://example.com',
      avatar: 'https://example.com/avatar.png',
      coverImage: 'https://example.com/cover.png',
      profileCompleted: true,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
      profileSkills: [
        {
          id: 10,
          userId: 1,
          name: '["React"]',
          level: null,
          sortOrder: 0,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
        {
          id: 11,
          userId: 1,
          name: 'NestJS',
          level: null,
          sortOrder: 1,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      profileCertifications: [],
      portfolioItems: [],
    });

    const result = await service.getMyProfile(1);

    expect(result.content).not.toHaveProperty('skill');
    expect(result.content).not.toHaveProperty('certification');
    expect(result.content.profileSkills).toEqual([
      expect.objectContaining({ name: 'React' }),
      expect.objectContaining({ name: 'NestJS' }),
    ]);
    expect(result.content.profileCertifications).toEqual([
      expect.objectContaining({ name: 'AWS' }),
    ]);
  });

  it('flattens accidentally stringified skill arrays before replacing profile skills', async () => {
    const { service, prisma } = createService();

    prisma.user.findUnique
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({
        name: 'Jane Doe',
        avatar: 'https://example.com/avatar.png',
        headline: 'Fullstack Developer',
        bio: 'Builds products',
        profileSkills: [{ id: 1 }],
      })
      .mockResolvedValueOnce({
        id: 1,
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: null,
        birthDay: null,
        gender: null,
        role: 'user',
        skill: JSON.stringify(['React', 'NestJS']),
        certification: null,
        headline: 'Fullstack Developer',
        bio: 'Builds products',
        location: null,
        website: null,
        avatar: 'https://example.com/avatar.png',
        coverImage: null,
        profileCompleted: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        profileSkills: [],
        profileCertifications: [],
        portfolioItems: [],
      });
    prisma.$transaction.mockResolvedValue([]);
    prisma.userSkill.findMany.mockResolvedValue([
      { name: 'React' },
      { name: 'NestJS' },
    ]);
    prisma.userCertification.findMany.mockResolvedValue([]);
    prisma.user.update
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ profileCompleted: true });

    await service.replaceProfileSkills(1, {
      skills: [{ name: '["React"]' }, { name: 'NestJS' }],
    });

    expect(prisma.userSkill.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 1, name: 'React', skillId: 'onet:react', level: undefined, sortOrder: 0 },
        { userId: 1, name: 'NestJS', skillId: 'skill:nestjs', level: undefined, sortOrder: 1 },
      ],
    });
  });

  it('saves skills under their dictionary names and rejects unknown or repeated ones', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });

    await expect(
      service.replaceProfileSkills(1, { skills: [{ name: 'SQL' }, { name: 'Reakt' }] }),
    ).rejects.toThrow('Not recognised: Reakt');
    // "reactjs" and "React" are the same dictionary skill.
    await expect(
      service.replaceProfileSkills(1, { skills: [{ name: 'reactjs' }, { name: 'React' }] }),
    ).rejects.toThrow('Duplicate skills are not allowed');
    expect(prisma.userSkill.createMany).not.toHaveBeenCalled();
  });

  it('still saves skills when the AI service is unavailable, without dictionary ids', async () => {
    const { service, prisma, skillService } = createService();
    skillService.requireKnownSkills.mockImplementation(() => {
      throw new ServiceUnavailableException('AI service is unavailable');
    });
    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      skill: null,
      certification: null,
      profileSkills: [],
      profileCertifications: [],
      portfolioItems: [],
    });
    prisma.$transaction.mockResolvedValue([]);
    prisma.userSkill.findMany.mockResolvedValue([]);
    prisma.userCertification.findMany.mockResolvedValue([]);
    prisma.user.update.mockResolvedValue({ profileCompleted: true });

    await service.replaceProfileSkills(1, { skills: [{ name: 'React' }] });

    expect(prisma.userSkill.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 1, name: 'React', skillId: null, level: undefined, sortOrder: 0 },
      ],
    });
  });

  it('re-evaluates the resume when skills change, and keeps levels when the resume sets the list', async () => {
    const { service, prisma, resumeAiQueue } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.$transaction.mockResolvedValue([]);
    prisma.user.update.mockResolvedValue({});
    prisma.userResume.count.mockResolvedValue(1);
    prisma.userSkill.findMany.mockResolvedValue([{ name: 'SQL', level: 'Expert' }]);
    prisma.userCertification.findMany.mockResolvedValue([]);
    jest.spyOn(service, 'getMyProfile').mockResolvedValue({} as any);

    await service.setSkillNames(1, ['React', 'sql']);

    expect(prisma.userSkill.createMany).toHaveBeenCalledWith({
      data: [
        { userId: 1, name: 'React', skillId: 'onet:react', level: undefined, sortOrder: 0 },
        { userId: 1, name: 'sql', skillId: 'skill:sql', level: 'Expert', sortOrder: 1 },
      ],
    });
    expect(resumeAiQueue.enqueue).toHaveBeenCalledWith(1);
  });

  it('requires the issuer, an expiry after the issue date, and no future issue date', async () => {
    const { service, prisma } = createService();
    const save = (certification: Record<string, unknown>) =>
      service.replaceProfileCertifications(1, {
        certifications: [{ name: 'CKA', issuer: 'CNCF', ...certification } as any],
      });

    await expect(save({ issuer: '' })).rejects.toThrow('Add the issuing organization');
    await expect(
      save({ issuedAt: '2024-05-01', expiresAt: '2024-01-01' }),
    ).rejects.toThrow('CKA: the expiry date is before the issue date');
    await expect(save({ issuedAt: '2999-01-01' })).rejects.toThrow(
      'The issue date cannot be in the future',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('saves the kind and the skills of a certification, without repeated skills', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.$transaction.mockResolvedValue([]);
    prisma.user.update.mockResolvedValue({});
    prisma.userSkill.findMany.mockResolvedValue([]);
    prisma.userCertification.findMany.mockResolvedValue([]);
    jest.spyOn(service, 'getMyProfile').mockResolvedValue({} as any);

    await service.replaceProfileCertifications(1, {
      certifications: [
        { name: 'CKA', issuer: 'CNCF', category: 'Certification', skills: ['Kubernetes', ' Kubernetes ', 'Docker'] },
      ],
    });

    expect(prisma.userCertification.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: 1, name: 'CKA', issuer: 'CNCF', category: 'Certification', skills: ['Kubernetes', 'Docker'] })],
    });
  });
});

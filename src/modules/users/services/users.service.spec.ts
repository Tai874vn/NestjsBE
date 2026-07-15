import { BadRequestException } from '@nestjs/common';
import { ProfileCompletionService } from './profile-completion.service';
import { UserLegacyProfileSyncService } from './user-legacy-profile-sync.service';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';
import { UsersService } from './users.service';

describe('UsersService profile behavior', () => {
  const createService = () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
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
      userResume: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
      comment: {
        aggregate: jest.fn(),
      },
      hire: {
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
    const service = new UsersService(
      prisma as any,
      redisService as any,
      profileCompletionService,
      legacyProfileSyncService,
      profileNormalizer,
    );

    return { service, prisma, redisService };
  };

  it('rejects duplicate profile certifications case-insensitively', async () => {
    const { service, prisma } = createService();

    await expect(
      service.replaceProfileCertifications(1, {
        certifications: [
          { name: 'AWS Certified Developer' },
          { name: ' aws certified developer ' },
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
    prisma.hire.count.mockResolvedValue(1);

    const result = await service.getPublicProfile(1);

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
    expect(prisma.hire.count).not.toHaveBeenCalled();
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
        { userId: 1, name: 'React', level: undefined, sortOrder: 0 },
        { userId: 1, name: 'NestJS', level: undefined, sortOrder: 1 },
      ],
    });
  });

  it('stores extracted resume data for the current user', async () => {
    const { service, prisma, redisService } = createService();
    const resumeData = {
      ResumeID: 'REAL_0001',
      Category: 'Java Developer',
      Name: 'Chad Griffin',
      Email: 'contact@email.com',
      Phone: '94105 555 4321000',
      Location: 'City, State',
      Summary: 'Highly skilled software development professional',
      Skills: 'Python, SQL, Git, Linux',
      Experience: 'Senior java developer',
      Education: 'Computer Science degree',
      Text: 'Full extracted resume text',
      Source: 'ResumeAtlas',
    };
    const storedResume = {
      id: 10,
      userId: 1,
      data: resumeData,
      sourceFileName: 'resume.pdf',
      schemaVersion: 'resume-atlas-v1',
      createdAt: new Date('2026-05-19T00:00:00.000Z'),
      updatedAt: new Date('2026-05-19T00:00:00.000Z'),
    };

    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.upsert.mockResolvedValue(storedResume);

    const result = await service.importResume(1, {
      data: resumeData,
      sourceFileName: ' resume.pdf ',
      schemaVersion: ' resume-atlas-v1 ',
    });

    expect(prisma.userResume.upsert).toHaveBeenCalledWith({
      where: { userId: 1 },
      update: {
        data: resumeData,
        sourceFileName: 'resume.pdf',
        schemaVersion: 'resume-atlas-v1',
      },
      create: {
        userId: 1,
        data: resumeData,
        sourceFileName: 'resume.pdf',
        schemaVersion: 'resume-atlas-v1',
      },
    });
    expect(redisService.invalidateUserCaches).toHaveBeenCalledWith(1);
    expect(result).toEqual({
      message: 'Resume imported successfully',
      content: storedResume,
    });
  });

  it('returns the current user resume data', async () => {
    const { service, prisma } = createService();
    const storedResume = {
      id: 10,
      userId: 1,
      data: { ResumeID: 'REAL_0001', Skills: 'Python, SQL, Git, Linux' },
      sourceFileName: null,
      schemaVersion: 'v1',
      createdAt: new Date('2026-05-19T00:00:00.000Z'),
      updatedAt: new Date('2026-05-19T00:00:00.000Z'),
    };

    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.findUnique.mockResolvedValue(storedResume);

    await expect(service.getMyResume(1)).resolves.toEqual({
      message: 'Get resume successfully',
      content: storedResume,
    });
    expect(prisma.userResume.findUnique).toHaveBeenCalledWith({
      where: { userId: 1 },
    });
  });

  it('stores uploaded resume document metadata for the current user', async () => {
    const { service, prisma, redisService } = createService();
    const storedResume = {
      id: 10,
      userId: 1,
      data: { ResumeID: 'REAL_0001' },
      sourceFileName: 'resume.pdf',
      sourceFileUrl: 'https://res.cloudinary.com/demo/raw/upload/resumes/resume.pdf',
      sourceFileMimeType: 'application/pdf',
      sourceFileSize: 2048,
      sourceFilePublicId: 'resumes/resume',
      schemaVersion: 'v1',
      createdAt: new Date('2026-05-20T00:00:00.000Z'),
      updatedAt: new Date('2026-05-20T00:00:00.000Z'),
    };

    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.upsert.mockResolvedValue(storedResume);

    const result = await service.uploadResumeFile(1, {
      originalName: ' resume.pdf ',
      mimeType: 'application/pdf',
      size: 2048,
      url: 'https://res.cloudinary.com/demo/raw/upload/resumes/resume.pdf',
      publicId: 'resumes/resume',
    });

    expect(prisma.userResume.upsert).toHaveBeenCalledWith({
      where: { userId: 1 },
      update: {
        sourceFileName: 'resume.pdf',
        sourceFileUrl: 'https://res.cloudinary.com/demo/raw/upload/resumes/resume.pdf',
        sourceFileMimeType: 'application/pdf',
        sourceFileSize: 2048,
        sourceFilePublicId: 'resumes/resume',
      },
      create: {
        userId: 1,
        data: {},
        sourceFileName: 'resume.pdf',
        sourceFileUrl: 'https://res.cloudinary.com/demo/raw/upload/resumes/resume.pdf',
        sourceFileMimeType: 'application/pdf',
        sourceFileSize: 2048,
        sourceFilePublicId: 'resumes/resume',
        schemaVersion: 'v1',
      },
    });
    expect(redisService.invalidateUserCaches).toHaveBeenCalledWith(1);
    expect(result).toEqual({
      message: 'Resume file uploaded successfully',
      content: storedResume,
    });
  });

});

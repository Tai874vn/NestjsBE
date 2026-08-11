import { Prisma } from '@prisma/client';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';
import { UserResumeService } from './user-resume.service';

describe('UserResumeService', () => {
  const createService = () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
      },
      userResume: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const redisService = {
      invalidateUserCaches: jest.fn(),
    };
    const aiClient = {
      predictResumeSeniority: jest.fn(),
    };
    const profileNormalizer = new UserProfileNormalizerService();
    const service = new UserResumeService(
      prisma as any,
      redisService as any,
      aiClient as any,
      profileNormalizer,
    );

    return { service, prisma, redisService, aiClient };
  };

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
        predictedSeniority: null,
        predictedSeniorityConfidence: null,
        predictedSeniorityModel: null,
        predictedSeniorityMetadata: Prisma.DbNull,
        predictedSeniorityAt: null,
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
      sourceFileUrl:
        'https://res.cloudinary.com/demo/raw/upload/resumes/resume.pdf',
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
        sourceFileUrl:
          'https://res.cloudinary.com/demo/raw/upload/resumes/resume.pdf',
        sourceFileMimeType: 'application/pdf',
        sourceFileSize: 2048,
        sourceFilePublicId: 'resumes/resume',
      },
      create: {
        userId: 1,
        data: {},
        sourceFileName: 'resume.pdf',
        sourceFileUrl:
          'https://res.cloudinary.com/demo/raw/upload/resumes/resume.pdf',
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

  it('predicts resume seniority through AI service and saves the result', async () => {
    const { service, prisma, redisService, aiClient } = createService();
    const storedResume = {
      id: 10,
      userId: 1,
      data: {
        Category: 'Backend Engineer',
        Role: 'Frontend Engineer',
        Industry: 'Software',
        YearsExperience: '1',
        Skills: 'Python, FastAPI',
        Education: 'BSc',
      },
      sourceFileName: 'resume.pdf',
      schemaVersion: 'v1',
      createdAt: new Date('2026-05-19T00:00:00.000Z'),
      updatedAt: new Date('2026-05-19T00:00:00.000Z'),
    };
    const predictedResume = {
      ...storedResume,
      predictedSeniority: 'Mid',
      predictedSeniorityConfidence: 0.72,
      predictedSeniorityModel: 'jobaura-recruiter-classifier',
      predictedSeniorityMetadata: {
        probabilities: { Junior: 0.1, Mid: 0.72, Senior: 0.18 },
        features: { role: 'Backend Engineer' },
        elapsedMs: 9,
      },
      predictedSeniorityAt: new Date('2026-07-30T00:00:00.000Z'),
    };

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      headline: null,
      skill: null,
      profileSkills: [{ name: 'Docker' }],
      resume: storedResume,
    });
    aiClient.predictResumeSeniority.mockResolvedValue({
      label: 'Mid',
      confidence: 0.72,
      probabilities: { Junior: 0.1, Mid: 0.72, Senior: 0.18 },
      features: { role: 'Backend Engineer' },
      model: 'jobaura-recruiter-classifier',
      elapsed_ms: 9,
    });
    prisma.userResume.update.mockResolvedValue(predictedResume);

    const result = await service.predictResumeSeniority(1);

    expect(aiClient.predictResumeSeniority).toHaveBeenCalledWith({
      resume: {
        role: 'Frontend Engineer',
        years_experience: '1',
        industry: 'Software',
        education: 'BSc',
        skills: ['Docker', 'Python', 'FastAPI'],
      },
    });
    expect(prisma.userResume.update).toHaveBeenCalledWith({
      where: { userId: 1 },
      data: expect.objectContaining({
        predictedSeniority: 'Mid',
        predictedSeniorityConfidence: 0.72,
        predictedSeniorityModel: 'jobaura-recruiter-classifier',
        predictedSeniorityMetadata: {
          probabilities: { Junior: 0.1, Mid: 0.72, Senior: 0.18 },
          features: { role: 'Backend Engineer' },
          elapsedMs: 9,
        },
        predictedSeniorityAt: expect.any(Date),
      }),
    });
    expect(redisService.invalidateUserCaches).toHaveBeenCalledWith(1);
    expect(result).toEqual({
      message: 'Resume seniority predicted successfully',
      content: predictedResume,
    });
  });

  it('requires a saved resume before predicting seniority', async () => {
    const { service, prisma } = createService();

    prisma.user.findUnique.mockResolvedValue({
      id: 1,
      headline: null,
      skill: null,
      profileSkills: [],
      resume: null,
    });

    await expect(service.predictResumeSeniority(1)).rejects.toThrow(
      'Resume for user ID 1 not found',
    );
  });
});

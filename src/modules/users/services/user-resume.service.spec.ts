import { Prisma } from '@prisma/client';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';
import { UserResumeService } from './user-resume.service';

describe('UserResumeService', () => {
  const createService = () => {
    const prisma = {
      user: { findUnique: jest.fn() },
      userResume: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    const redisService = { invalidateUserCaches: jest.fn() };
    // Saving and "Try again" only talk to the queue; there is no AI client here at all.
    const aiQueue = {
      kick: jest.fn(),
      enqueue: jest.fn((userId: number) =>
        Promise.resolve({ userId, aiStatus: 'QUEUED' }),
      ),
    };
    const service = new UserResumeService(
      prisma as any,
      redisService as any,
      new UserProfileNormalizerService(),
      aiQueue as any,
    );
    return { service, prisma, redisService, aiQueue };
  };

  it('saves the resume and queues AI work without calling the AI service', async () => {
    const { service, prisma, redisService, aiQueue } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.upsert.mockImplementation((args) =>
      Promise.resolve({ id: 10, ...args.create }),
    );

    const result = await service.importResume(1, {
      data: { Industry: 'QA', Skills: 'reactjs, SQL, reactjs ', Name: 'Ava' },
      sourceFileName: ' resume.pdf ',
      schemaVersion: ' resume-atlas-v1 ',
    });

    const args = prisma.userResume.upsert.mock.calls[0][0];
    // Skills are kept as written (deduplicated); the queue puts them under dictionary names later.
    expect(args.create.data).toEqual({
      Industry: 'QA',
      Skills: 'reactjs, SQL',
      Name: 'Ava',
    });
    expect(args.create).toMatchObject({
      sourceFileName: 'resume.pdf',
      schemaVersion: 'resume-atlas-v1',
      aiStatus: 'QUEUED',
      aiAttempts: 0,
    });
    expect(args.update).toMatchObject({
      aiStatus: 'QUEUED',
      predictedSeniority: null,
      aiInsights: Prisma.DbNull,
    });
    expect(aiQueue.kick).toHaveBeenCalled();
    expect(redisService.invalidateUserCaches).toHaveBeenCalledWith(1);
    expect(result.message).toBe('Resume imported successfully');
  });

  it('rejects a field outside the list, a bad field-of-study code, and incomplete jobs', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });

    await expect(
      service.importResume(1, { data: { Industry: 'Software' } }),
    ).rejects.toThrow('Choose your field from the list.');
    await expect(
      service.importResume(1, {
        data: { Industry: 'QA', FieldOfStudy: 'computing' },
      }),
    ).rejects.toThrow('Choose your field of study from the list.');
    await expect(
      service.importResume(1, {
        data: {
          Industry: 'QA',
          Jobs: [
            { title: 'Tester', field: 'QA', start: '2022-05', end: '2021-01' },
          ],
        },
      }),
    ).rejects.toThrow('Job 1: the end month is before the start month.');
    expect(prisma.userResume.upsert).not.toHaveBeenCalled();
  });

  it('queues an evaluation when the field and years are present', async () => {
    const { service, prisma, aiQueue } = createService();
    prisma.userResume.findUnique.mockResolvedValue({
      data: { Industry: 'QA', YearsExperience: '3' },
    });

    const result = await service.predictResumeSeniority(1);

    expect(aiQueue.enqueue).toHaveBeenCalledWith(1);
    expect(result).toEqual({
      message: 'Resume queued for AI evaluation',
      content: { userId: 1, aiStatus: 'QUEUED' },
    });
  });

  it('asks for the field and years before queueing an evaluation', async () => {
    const { service, prisma, aiQueue } = createService();

    prisma.userResume.findUnique.mockResolvedValue(null);
    await expect(service.predictResumeSeniority(1)).rejects.toThrow(
      'Resume for user ID 1 not found',
    );
    prisma.userResume.findUnique.mockResolvedValue({ data: { Skills: 'SQL' } });
    await expect(service.predictResumeSeniority(1)).rejects.toThrow(
      'Choose your field',
    );
    prisma.userResume.findUnique.mockResolvedValue({
      data: { Industry: 'QA', Specialty: 'Manual testing' },
    });
    await expect(service.predictResumeSeniority(1)).rejects.toThrow(
      'Add jobs with dates in your field',
    );
    expect(aiQueue.enqueue).not.toHaveBeenCalled();
  });

  it('returns the current user resume data', async () => {
    const { service, prisma } = createService();
    const storedResume = { id: 10, userId: 1, data: { Skills: 'SQL' } };
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.findUnique.mockResolvedValue(storedResume);

    await expect(service.getMyResume(1)).resolves.toEqual({
      message: 'Get resume successfully',
      content: storedResume,
    });
  });

  it('stores uploaded resume document metadata for the current user', async () => {
    const { service, prisma, redisService } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.upsert.mockResolvedValue({ id: 10 });

    await service.uploadResumeFile(1, {
      originalName: ' resume.pdf ',
      mimeType: 'application/pdf',
      size: 2048,
      url: 'https://res.cloudinary.com/demo/raw/upload/resumes/resume.pdf',
      publicId: 'resumes/resume',
    });

    expect(prisma.userResume.upsert.mock.calls[0][0].update).toEqual({
      sourceFileName: 'resume.pdf',
      sourceFileUrl:
        'https://res.cloudinary.com/demo/raw/upload/resumes/resume.pdf',
      sourceFileMimeType: 'application/pdf',
      sourceFileSize: 2048,
      sourceFilePublicId: 'resumes/resume',
    });
    expect(redisService.invalidateUserCaches).toHaveBeenCalledWith(1);
  });
});

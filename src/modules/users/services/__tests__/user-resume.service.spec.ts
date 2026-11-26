import { Prisma } from '@prisma/client';
import { UserProfileNormalizerService } from '../user-profile-normalizer.service';
import { UserResumeService } from '../user-resume.service';

describe('UserResumeService', () => {
  const createService = () => {
    const prisma = {
      user: { findUnique: jest.fn() },
      userResume: {
        upsert: jest.fn(),
        findUnique: jest.fn(),
      },
      userSkill: { findMany: jest.fn(() => Promise.resolve([] as Array<{ name: string }>)) },
    };
    const redisService = { invalidateUserCaches: jest.fn() };
    // Saving and "Try again" only talk to the queue; there is no AI client here at all.
    const aiQueue = {
      kick: jest.fn(),
      enqueue: jest.fn((userId: number) =>
        Promise.resolve({ userId, aiStatus: 'QUEUED', data: {} }),
      ),
    };
    const profileService = { setSkillNames: jest.fn() };
    const service = new UserResumeService(
      prisma as any,
      redisService as any,
      new UserProfileNormalizerService(),
      aiQueue as any,
      profileService as any,
    );
    return { service, prisma, redisService, aiQueue, profileService };
  };

  it('saves the resume and queues AI work without calling the AI service', async () => {
    const { service, prisma, redisService, aiQueue, profileService } =
      createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.upsert.mockImplementation((args) =>
      Promise.resolve({ id: 10, ...args.create }),
    );

    const result = await service.importResume(1, {
      data: { Occupation: '2513.5', Skills: 'reactjs, SQL, reactjs ', Name: 'Ava' },
      sourceFileName: ' resume.pdf ',
      schemaVersion: ' resume-atlas-v1 ',
    });

    const args = prisma.userResume.upsert.mock.calls[0][0];
    // Skills go to the shared list (deduplicated), not into the resume.
    expect(profileService.setSkillNames).toHaveBeenCalledWith(1, [
      'reactjs',
      'SQL',
    ]);
    expect(args.create.data).toEqual({ Occupation: '2513.5', Name: 'Ava' });
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

  it('rejects an unknown occupation or specialty, a bad field-of-study code, and incomplete jobs (400)', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });

    await expect(
      service.importResume(1, { data: { Occupation: '9999.9' } }),
    ).rejects.toMatchObject({
      status: 400,
      message: 'Choose your occupation from the list.',
    });
    await expect(
      service.importResume(1, {
        data: { Occupation: '2513.5', Specialty: 'Rocket surgery' },
      }),
    ).rejects.toThrow('Choose a specialty listed under your occupation.');
    await expect(
      service.importResume(1, { data: { Specialty: 'Web Developers' } }),
    ).rejects.toThrow('Choose your occupation before its specialty.');
    await expect(
      service.importResume(1, {
        data: { Occupation: '2513.5', FieldOfStudy: 'computing' },
      }),
    ).rejects.toThrow('Choose your field of study from the list.');
    await expect(
      service.importResume(1, {
        data: {
          Occupation: '2513.5',
          Jobs: [
            { title: 'Tester', occupation: '9999.9', start: '2022-05', end: '2023-01' },
          ],
        },
      }),
    ).rejects.toThrow('Job 1: choose the occupation from the list.');
    await expect(
      service.importResume(1, {
        data: {
          Occupation: '2513.5',
          Jobs: [
            { title: 'Tester', occupation: '2513.5', start: '2022-05', end: '2021-01' },
          ],
        },
      }),
    ).rejects.toThrow('Job 1: the end month is before the start month.');
    expect(prisma.userResume.upsert).not.toHaveBeenCalled();
  });

  it('queues an evaluation when the occupation is present', async () => {
    const { service, prisma, aiQueue } = createService();
    prisma.userResume.findUnique.mockResolvedValue({
      data: { Occupation: '2513.5', YearsExperience: '3' },
    });

    const result = await service.predictResumeSeniority(1);

    expect(aiQueue.enqueue).toHaveBeenCalledWith(1);
    expect(result).toEqual({
      message: 'Resume queued for AI evaluation',
      content: {
        userId: 1,
        aiStatus: 'QUEUED',
        data: { Skills: '' },
        occupationYears: null,
      },
    });
  });

  it('asks for the occupation before queueing an evaluation; years come from the jobs', async () => {
    const { service, prisma, aiQueue } = createService();

    prisma.userResume.findUnique.mockResolvedValue(null);
    await expect(service.predictResumeSeniority(1)).rejects.toThrow(
      'Resume for user ID 1 not found',
    );
    prisma.userResume.findUnique.mockResolvedValue({ data: { Skills: 'SQL' } });
    await expect(service.predictResumeSeniority(1)).rejects.toThrow(
      'Choose your occupation in the resume before requesting AI seniority prediction',
    );
    // A migrated resume (empty Occupation, LegacyField kept) also needs its occupation chosen.
    prisma.userResume.findUnique.mockResolvedValue({
      data: { Occupation: '', LegacyField: 'QA' },
    });
    await expect(service.predictResumeSeniority(1)).rejects.toThrow(
      'Choose your occupation',
    );
    expect(aiQueue.enqueue).not.toHaveBeenCalled();
    // An occupation with no jobs in it is 0 years, someone starting out, and can be evaluated.
    prisma.userResume.findUnique.mockResolvedValue({
      data: { Occupation: '2513.5' },
    });
    await service.predictResumeSeniority(1);
    expect(aiQueue.enqueue).toHaveBeenCalledWith(1);
  });

  it('does not keep a typed-in years number', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.upsert.mockImplementation((args) => Promise.resolve({ id: 10, userId: 1, ...args.create }));

    await service.importResume(1, { data: { Occupation: '2513.5', YearsExperience: '7' } });

    expect(prisma.userResume.upsert.mock.calls[0][0].create.data).toEqual({ Occupation: '2513.5' });
  });

  it('still saves a resume from before occupations: its stored Industry and job fields become read-only legacy values', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.findUnique.mockResolvedValue({
      data: { Industry: 'QA', Jobs: [{ title: 'Tester', field: 'QA', start: '2022-05', end: '', current: true }] },
    });
    prisma.userResume.upsert.mockImplementation((args) => Promise.resolve({ id: 10, userId: 1, ...args.create }));

    await service.importResume(1, {
      data: {
        Industry: 'QA',
        Jobs: [{ title: 'Tester', field: 'QA', start: '2022-05', end: '', current: true }],
      },
    });

    expect(prisma.userResume.upsert.mock.calls[0][0].create.data).toEqual({
      LegacyField: 'QA',
      Jobs: [
        { title: 'Tester', occupation: '', legacyField: 'QA', start: '2022-05', end: '', current: true, description: '' },
      ],
    });
  });

  it('keeps the stored legacy values and ignores the ones the form sends', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.findUnique.mockResolvedValue({
      data: {
        Occupation: '',
        LegacyField: 'QA',
        Jobs: [
          { title: 'Tester', occupation: '', legacyField: 'QA', start: '2022-05', end: '', current: true, description: '' },
        ],
      },
    });
    prisma.userResume.upsert.mockImplementation((args) => Promise.resolve({ id: 10, userId: 1, ...args.create }));

    await service.importResume(1, {
      data: {
        Occupation: '2513.5',
        LegacyField: 'x'.repeat(500),
        Industry: 'Finance',
        Jobs: [
          { title: 'Tester', occupation: '2513.5', legacyField: 'Forged', start: '2022-05', end: '', current: true },
          { title: 'Web developer', occupation: '2513.5', legacyField: 'Forged', start: '2024-01', end: '', current: true },
        ],
      },
    });

    expect(prisma.userResume.upsert.mock.calls[0][0].create.data).toEqual({
      Occupation: '2513.5',
      LegacyField: 'QA',
      Jobs: [
        { title: 'Tester', occupation: '2513.5', legacyField: 'QA', start: '2022-05', end: '', current: true, description: '' },
        { title: 'Web developer', occupation: '2513.5', start: '2024-01', end: '', current: true, description: '' },
      ],
    });
  });

  it('stores no legacy values for a new resume, and caps a stored one at 60 characters', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.upsert.mockImplementation((args) => Promise.resolve({ id: 10, userId: 1, ...args.create }));

    prisma.userResume.findUnique.mockResolvedValue(null);
    await service.importResume(1, { data: { Occupation: '2513.5', LegacyField: 'Forged', Industry: 'QA' } });
    expect(prisma.userResume.upsert.mock.calls[0][0].create.data).toEqual({ Occupation: '2513.5' });

    prisma.userResume.findUnique.mockResolvedValue({ data: { LegacyField: 'y'.repeat(200) } });
    await service.importResume(1, { data: { Occupation: '2513.5' } });
    expect(prisma.userResume.upsert.mock.calls[1][0].create.data).toEqual({
      Occupation: '2513.5',
      LegacyField: 'y'.repeat(60),
    });
  });

  it('opens a migrated resume unchanged', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    const data = {
      Occupation: '',
      LegacyField: 'QA',
      Jobs: [{ title: 'Tester', occupation: '', legacyField: 'QA', start: '2022-05', end: '', current: true, description: '' }],
    };
    prisma.userResume.findUnique.mockResolvedValue({ id: 10, userId: 1, data, aiStatus: 'NEEDS_INPUT' });

    const result = await service.getMyResume(1);

    expect(result.content).toMatchObject({ aiStatus: 'NEEDS_INPUT', data: { ...data } });
  });

  it('returns the resume with the shared skill list as its Skills', async () => {
    const { service, prisma } = createService();
    const storedResume = { id: 10, userId: 1, data: { Industry: 'QA', Skills: 'stale' } };
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.findUnique.mockResolvedValue(storedResume);
    prisma.userSkill.findMany.mockResolvedValue([{ name: 'SQL' }, { name: 'Jest' }]);

    await expect(service.getMyResume(1)).resolves.toEqual({
      message: 'Get resume successfully',
      content: {
        ...storedResume,
        data: { Industry: 'QA', Skills: 'SQL, Jest' },
        occupationYears: null,
      },
    });
  });

  it('adds the read-only years breakdown counted from the saved jobs', async () => {
    const { service, prisma } = createService();
    const data = {
      Occupation: '2513.5',
      Jobs: [
        { title: 'Web developer', occupation: '2513.5', start: '2020-01', end: '2023-01', current: false, description: '' },
      ],
    };
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.findUnique.mockResolvedValue({ id: 10, userId: 1, data });
    prisma.userSkill.findMany.mockResolvedValue([]);

    const result = await service.getMyResume(1);

    expect(result.content.occupationYears).toEqual({
      occupation: { code: '2513.5', title: 'web developer' },
      years: 3,
      related: 0,
      otherCredit: 0,
      capped: false,
      others: [],
    });
  });

  it('leaves the skill list alone when the form sends no Skills', async () => {
    const { service, prisma, profileService } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.upsert.mockResolvedValue({ id: 10 });

    await service.importResume(1, { data: { Industry: 'QA' } });

    expect(profileService.setSkillNames).not.toHaveBeenCalled();
  });

  it('stores uploaded resume document metadata and returns the authenticated download path', async () => {
    const { service, prisma, redisService } = createService();
    const docKey =
      'documents/resumes/550e8400-e29b-41d4-a716-446655440000.pdf';
    prisma.user.findUnique.mockResolvedValue({ id: 1 });
    prisma.userResume.upsert.mockImplementation((args) =>
      Promise.resolve({ id: 10, userId: 1, data: {}, ...args.update }),
    );

    const result = await service.uploadResumeFile(1, {
      originalName: ' resume.pdf ',
      mimeType: 'application/pdf',
      size: 2048,
      url: docKey,
      publicId: docKey,
    });

    expect(prisma.userResume.upsert.mock.calls[0][0].update).toEqual({
      sourceFileName: 'resume.pdf',
      sourceFileUrl: docKey,
      sourceFileMimeType: 'application/pdf',
      sourceFileSize: 2048,
      sourceFilePublicId: docKey,
    });
    expect(result.content.sourceFileUrl).toBe(`/api/files/${docKey}`);
    expect(redisService.invalidateUserCaches).toHaveBeenCalledWith(1);
  });
});

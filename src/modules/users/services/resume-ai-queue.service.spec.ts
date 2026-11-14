import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AI_UNAVAILABLE_MESSAGE, ResumeAiQueueService } from './resume-ai-queue.service';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';

const QUEUED_AT = new Date('2026-11-15T00:00:00.000Z');

function setup({
  available = true,
  data = {} as Record<string, unknown>,
  waiting = 1,
}) {
  let queued = waiting;
  const prisma = {
    userResume: {
      count: jest.fn((args: { where: { aiStatus: string } }) =>
        Promise.resolve(args.where.aiStatus === 'QUEUED' ? queued : 0),
      ),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      update: jest.fn(),
    },
    // Claiming returns the queued resume once, then nothing.
    $queryRaw: jest.fn(() => {
      const rows = queued > 0 ? [{ id: 10, userId: 1, aiQueuedAt: QUEUED_AT }] : [];
      queued = 0;
      return Promise.resolve(rows);
    }),
    user: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          headline: null,
          skill: null,
          profileSkills: [],
          resume: { id: 10, data },
        }),
      ),
    },
  };
  const aiClient = {
    isAvailable: jest.fn(() => Promise.resolve(available)),
    resolveSkills: jest.fn((names: string[]) =>
      Promise.resolve(
        names.map((name) =>
          name.toLowerCase() === 'reactjs'
            ? { id: 'onet:react', name: 'React' }
            : name === 'Reakt'
              ? null
              : { id: `skill:${name}`, name },
        ),
      ),
    ),
    extractSkills: jest.fn(() =>
      Promise.resolve([
        { id: 'onet:react', name: 'React', matched: ['ReactJS'] },
        { id: 'onet:docker', name: 'Docker', matched: ['docker'] },
      ]),
    ),
    predictResumeSeniority: jest.fn(() =>
      Promise.resolve({
        label: 'Mid',
        confidence: 0.9,
        probabilities: { Junior: 0.05, Mid: 0.9, Senior: 0.05 },
        features: { tier: 'New Mid' },
        model: 'm',
        elapsed_ms: 3,
      }),
    ),
  };
  const redisService = { invalidateUserCaches: jest.fn() };
  const config = { get: jest.fn(() => '0') };
  const queue = new ResumeAiQueueService(
    prisma as any,
    redisService as any,
    aiClient as any,
    new UserProfileNormalizerService(),
    config as any,
  );
  const written = () =>
    (prisma.userResume.updateMany.mock.calls as unknown as Array<[any]>).map(
      ([args]) => args,
    );
  return { queue, prisma, aiClient, redisService, written };
}

describe('ResumeAiQueueService', () => {
  it('hands queued work back as "try again" when the AI service is down', async () => {
    const { queue, aiClient, prisma, written } = setup({ available: false });

    await queue.processQueue();

    expect(aiClient.resolveSkills).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(written()).toEqual([
      {
        where: { aiStatus: 'QUEUED' },
        data: {
          aiStatus: 'AI_UNAVAILABLE',
          aiStatusMessage: AI_UNAVAILABLE_MESSAGE,
        },
      },
    ]);
  });

  it('resolves skills, suggests CV skills, and predicts seniority when the AI is up', async () => {
    const { queue, written, redisService } = setup({
      data: {
        Industry: 'Software development',
        YearsExperience: '3',
        Skills: 'reactjs, SQL, Reakt',
        Text: 'Built apps with ReactJS and docker.',
      },
    });

    await queue.processQueue();

    const [update] = written();
    expect(update.where).toEqual({ id: 10, aiQueuedAt: QUEUED_AT });
    expect(update.data).toMatchObject({
      aiStatus: 'DONE',
      aiStatusMessage: null,
      aiClaimedAt: null,
      predictedSeniority: 'Mid',
      data: expect.objectContaining({
        Skills: 'React, SQL, Reakt',
        SkillIds: ['onet:react', 'skill:SQL'],
      }),
      aiInsights: {
        unrecognisedSkills: ['Reakt'],
        suggestedSkills: [{ id: 'onet:docker', name: 'Docker', matched: ['docker'] }],
      },
    });
    expect(redisService.invalidateUserCaches).toHaveBeenCalledWith(1);
  });

  it('asks for input instead of predicting when the field or years are missing', async () => {
    const { queue, aiClient, written } = setup({ data: { Skills: 'SQL' } });

    await queue.processQueue();

    expect(aiClient.predictResumeSeniority).not.toHaveBeenCalled();
    expect(written()[0].data.aiStatus).toBe('NEEDS_INPUT');
  });

  it('marks AI failures as "try again" and refused input as failed', async () => {
    const data = { Industry: 'QA', YearsExperience: '2' };
    const down = setup({ data });
    down.aiClient.predictResumeSeniority.mockRejectedValue(
      new ServiceUnavailableException('AI service returned 503'),
    );
    await down.queue.processQueue();
    expect(down.written()[0].data).toMatchObject({
      aiStatus: 'AI_UNAVAILABLE',
      aiStatusMessage: AI_UNAVAILABLE_MESSAGE,
    });

    const refused = setup({ data });
    refused.aiClient.predictResumeSeniority.mockRejectedValue(
      new BadRequestException('Choose a field from the JobAura list'),
    );
    await refused.queue.processQueue();
    expect(refused.written()[0].data).toMatchObject({
      aiStatus: 'FAILED',
      aiStatusMessage: 'Choose a field from the JobAura list',
    });
  });

  it('skips the write when the resume was saved again during processing', async () => {
    const { queue, prisma, redisService } = setup({
      data: { Industry: 'QA', YearsExperience: '2' },
    });
    prisma.userResume.updateMany.mockResolvedValue({ count: 0 });

    await queue.processQueue();

    expect(redisService.invalidateUserCaches).not.toHaveBeenCalled();
  });

  it('does nothing when the queue is empty', async () => {
    const { queue, aiClient } = setup({ waiting: 0 });

    await queue.processQueue();

    expect(aiClient.isAvailable).not.toHaveBeenCalled();
  });
});

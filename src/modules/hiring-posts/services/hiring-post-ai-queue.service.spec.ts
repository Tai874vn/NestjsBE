import {
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  HIRING_POST_AI_UNAVAILABLE_MESSAGE,
  HIRING_POST_NEEDS_INPUT_MESSAGE,
  HiringPostAiQueueService,
} from './hiring-post-ai-queue.service';

const QUEUED_AT = new Date('2026-11-15T00:00:00.000Z');
const post = {
  id: 10,
  recruiterId: 2,
  title: 'Backend Engineer',
  description: 'Build and run our APIs',
  requirements: null,
  careerField: 'Software development',
  yearsRequired: 3,
  skills: ['Node.js'],
  updatedAt: QUEUED_AT,
};

function setup({ available = true, row = post as Record<string, unknown>, prediction = undefined as unknown }) {
  let queued = 1;
  const prisma = {
    hiringPost: {
      count: jest.fn((args: { where: { aiStatus: string } }) =>
        Promise.resolve(args.where.aiStatus === 'QUEUED' ? queued : 0),
      ),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
      update: jest.fn(() => Promise.resolve(row)),
      findUnique: jest.fn(() => Promise.resolve(row)),
    },
    // Claiming returns the queued post once, then nothing.
    $queryRaw: jest.fn(() => {
      const rows = queued > 0 ? [{ id: 10, aiQueuedAt: QUEUED_AT }] : [];
      queued = 0;
      return Promise.resolve(rows);
    }),
  };
  const aiClient = {
    isAvailable: jest.fn(() => Promise.resolve(available)),
    predictJobSeniority: jest.fn(() =>
      prediction instanceof Error
        ? Promise.reject(prediction)
        : Promise.resolve({
            label: 'Mid',
            confidence: 0.97,
            probabilities: { Junior: 0.01, Mid: 0.97, Senior: 0.02 },
            features: { years_from: 'set by the recruiter' },
            model: 'm',
            elapsed_ms: 4,
          }),
    ),
  };
  const payloadMapper = { buildHiringPostPayload: jest.fn(() => ({ id: 10, career_field: 'Software development' })) };
  const config = { get: jest.fn(() => '0') };
  const queue = new HiringPostAiQueueService(prisma as never, aiClient as never, payloadMapper as never, config as never);
  // The data written for the claimed post (the last updateMany that targets it by id).
  const written = () => {
    const calls = prisma.hiringPost.updateMany.mock.calls as unknown as Array<[{ where: { id?: number }; data: Record<string, unknown> }]>;
    return calls.filter(([args]) => args.where.id === 10).pop()?.[0];
  };
  return { queue, prisma, aiClient, written };
}

describe('HiringPostAiQueueService', () => {
  it('saves the AI level for a queued post', async () => {
    const { queue, written, aiClient } = setup({});

    await queue.processQueue();

    expect(aiClient.predictJobSeniority).toHaveBeenCalledWith({ job: { id: 10, career_field: 'Software development' } });
    expect(written()?.data).toMatchObject({ aiStatus: 'DONE', predictedSeniority: 'Mid', aiClaimedAt: null });
  });

  it('writes only if the post was not saved again meanwhile', async () => {
    const { queue, written } = setup({});

    await queue.processQueue();

    expect(written()?.where).toEqual({ id: 10, aiQueuedAt: QUEUED_AT });
  });

  it('hands the work back with "Try again" when the AI service is down', async () => {
    const { queue, prisma, aiClient } = setup({ available: false });

    await queue.processQueue();

    expect(aiClient.predictJobSeniority).not.toHaveBeenCalled();
    expect(prisma.hiringPost.updateMany).toHaveBeenCalledWith({
      where: { aiStatus: 'QUEUED' },
      data: { aiStatus: 'AI_UNAVAILABLE', aiStatusMessage: HIRING_POST_AI_UNAVAILABLE_MESSAGE },
    });
  });

  it('asks for the field and years when the post has none', async () => {
    const { queue, written, aiClient } = setup({ row: { ...post, careerField: null } });

    await queue.processQueue();

    expect(aiClient.predictJobSeniority).not.toHaveBeenCalled();
    expect(written()?.data).toMatchObject({ aiStatus: 'NEEDS_INPUT', aiStatusMessage: HIRING_POST_NEEDS_INPUT_MESSAGE });
  });

  it('records a refused input as FAILED with the reason', async () => {
    const { queue, written } = setup({ prediction: new BadRequestException('The job title does not name a field') });

    await queue.processQueue();

    expect(written()?.data).toMatchObject({ aiStatus: 'FAILED', aiStatusMessage: 'The job title does not name a field' });
  });

  it('marks the post AI_UNAVAILABLE when the AI fails mid-request', async () => {
    const { queue, written } = setup({ prediction: new ServiceUnavailableException('down') });

    await queue.processQueue();

    expect(written()?.data).toMatchObject({ aiStatus: 'AI_UNAVAILABLE' });
  });
});

import { RecommendationSnapshotKind } from '@prisma/client';
import { RecommendationSnapshotService } from './recommendation-snapshot.service';

const prisma = {
  recommendationSnapshot: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
};

describe('RecommendationSnapshotService', () => {
  let service: RecommendationSnapshotService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RecommendationSnapshotService(prisma as any);
    prisma.recommendationSnapshot.upsert.mockResolvedValue({});
  });

  it('saves the latest job recommendation snapshot by stable scope', async () => {
    await service.saveJobs(7, 10, 50, {
      data: [{ id: 101, createdAt: new Date('2026-07-16T00:00:00.000Z') }],
      model: 'model',
      elapsedMs: 42,
      generatedAt: '2026-07-16T01:00:00.000Z',
    });

    expect(prisma.recommendationSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scopeKey: 'jobs:7:10:50' },
        create: expect.objectContaining({
          scopeKey: 'jobs:7:10:50',
          userId: 7,
          kind: RecommendationSnapshotKind.JOBS,
          jobId: null,
          topK: 10,
          poolSize: 50,
          modelName: 'model',
          elapsedMs: 42,
          data: [{ id: 101, createdAt: '2026-07-16T00:00:00.000Z' }],
        }),
        update: expect.objectContaining({
          modelName: 'model',
          data: [{ id: 101, createdAt: '2026-07-16T00:00:00.000Z' }],
        }),
      }),
    );
  });

  it('reads saved candidate snapshots as cached recommendation results', async () => {
    prisma.recommendationSnapshot.findUnique.mockResolvedValue({
      data: [{ id: 9 }],
      modelName: 'model',
      elapsedMs: 12,
      generatedAt: new Date('2026-07-16T01:00:00.000Z'),
    });

    const result = await service.getCandidates(7, 3, 5, 25);

    expect(prisma.recommendationSnapshot.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { scopeKey: 'candidates:7:3:5:25' },
      }),
    );
    expect(result).toEqual({
      data: [{ id: 9 }],
      model: 'model',
      elapsedMs: 12,
      generatedAt: '2026-07-16T01:00:00.000Z',
    });
  });
});

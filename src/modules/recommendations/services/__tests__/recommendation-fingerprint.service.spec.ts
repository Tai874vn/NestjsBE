import { RecommendationFingerprintService } from '../recommendation-fingerprint.service';

describe('RecommendationFingerprintService bucketing', () => {
  const createService = () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        aggregate: jest.fn(),
      },
      userSkill: {
        aggregate: jest.fn(),
      },
      userResume: {
        aggregate: jest.fn(),
      },
      hiringPost: {
        aggregate: jest.fn(),
      },
    };
    const configService = {
      get: jest.fn().mockReturnValue('v1'),
    };
    const service = new RecommendationFingerprintService(
      prisma as never,
      configService as never,
    );
    return { service, prisma };
  };

  describe('jobs() fingerprint', () => {
    it('buckets global hiringPost pool updates to 1-hour windows while keeping user timestamps exact', async () => {
      const { service, prisma } = createService();
      const userUpdated = new Date('2026-11-25T09:12:34.000Z');
      const resumeUpdated = new Date('2026-11-25T09:15:00.000Z');
      const skillUpdated = new Date('2026-11-25T09:20:00.000Z');

      prisma.user.findUnique.mockResolvedValue({
        updatedAt: userUpdated,
        resume: { updatedAt: resumeUpdated },
      });
      prisma.userSkill.aggregate.mockResolvedValue({
        _max: { updatedAt: skillUpdated },
      });

      // Two pool edits inside the same hour (10:05 and 10:55) keep the same fingerprint.
      prisma.hiringPost.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T10:05:00.000Z') },
      });
      const fp1 = await service.jobs(7);

      prisma.hiringPost.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T10:55:59.000Z') },
      });
      const fp2 = await service.jobs(7);
      expect(fp2).toBe(fp1);

      // Crossing into the next hour (11:00) produces a new fingerprint.
      prisma.hiringPost.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T11:00:01.000Z') },
      });
      const fpNextHour = await service.jobs(7);
      expect(fpNextHour).not.toBe(fp1);

      // Editing the target user's own timestamp by 1 second changes the fingerprint immediately.
      prisma.hiringPost.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T10:05:00.000Z') },
      });
      prisma.user.findUnique.mockResolvedValueOnce({
        updatedAt: new Date('2026-11-25T09:12:35.000Z'),
        resume: { updatedAt: resumeUpdated },
      });
      const fpUserEdited = await service.jobs(7);
      expect(fpUserEdited).not.toBe(fp1);
    });
  });

  describe('hiringPostCandidates() fingerprint', () => {
    it('buckets candidate pool updates to 1-hour windows while keeping hiringPostUpdatedAt exact', async () => {
      const { service, prisma } = createService();
      const postUpdatedAt = new Date('2026-11-25T08:30:10.000Z');

      // Candidate profile edit at 10:10, then another candidate resume edit at 10:45 -> same 10:00 hour bucket.
      prisma.user.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T10:10:00.000Z') },
      });
      prisma.userResume.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T09:00:00.000Z') },
      });
      prisma.userSkill.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T09:00:00.000Z') },
      });
      const fp1 = await service.hiringPostCandidates(20, postUpdatedAt);

      prisma.user.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T10:10:00.000Z') },
      });
      prisma.userResume.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T10:45:00.000Z') },
      });
      prisma.userSkill.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T10:50:00.000Z') },
      });
      const fp2 = await service.hiringPostCandidates(20, postUpdatedAt);
      expect(fp2).toBe(fp1);

      // Next hour changes the fingerprint.
      prisma.user.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T11:02:00.000Z') },
      });
      prisma.userResume.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T10:45:00.000Z') },
      });
      prisma.userSkill.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T10:50:00.000Z') },
      });
      const fpNextHour = await service.hiringPostCandidates(20, postUpdatedAt);
      expect(fpNextHour).not.toBe(fp1);

      // Target hiring post updated by 1 second changes the fingerprint immediately.
      prisma.user.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T10:10:00.000Z') },
      });
      prisma.userResume.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T09:00:00.000Z') },
      });
      prisma.userSkill.aggregate.mockResolvedValueOnce({
        _max: { updatedAt: new Date('2026-11-25T09:00:00.000Z') },
      });
      const fpPostEdited = await service.hiringPostCandidates(
        20,
        new Date('2026-11-25T08:30:11.000Z'),
      );
      expect(fpPostEdited).not.toBe(fp1);
    });
  });
});

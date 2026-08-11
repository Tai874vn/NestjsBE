import { ForbiddenException } from '@nestjs/common';
import { CommentsService } from './comments.service';

describe('CommentsService review eligibility', () => {
  const createService = () => {
    const prisma = {
      job: { findUnique: jest.fn() },
      hire: { findFirst: jest.fn() },
      comment: { findFirst: jest.fn(), create: jest.fn() },
    };
    const redis = { invalidateCommentCaches: jest.fn(), invalidateUserCaches: jest.fn() };
    return { service: new CommentsService(prisma as never, redis as never), prisma };
  };

  it('rejects a review when the user has not completed a hire for the service', async () => {
    const { service, prisma } = createService();
    prisma.job.findUnique.mockResolvedValue({ id: 10, creatorId: 3 });
    prisma.hire.findFirst.mockResolvedValue(null);

    await expect(service.create({ jobId: 10, content: 'Review', rating: 5 }, 2))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.comment.create).not.toHaveBeenCalled();
  });
});

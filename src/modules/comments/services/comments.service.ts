/**
 * Service for the comments (reviews) module.
 * It creates one review per finished contract, reads reviews, edits and deletes reviews with ownership checks, notifies freelancers, and clears Redis caches.
 *
 * Calls: prisma.comment; RedisService; ContractStepService; ruleToHttp; checkReview; ContractEventsService
 * Used by:
 *   - src/modules/comments/comments.module.ts
 *   - src/modules/comments/controllers/comments.controller.ts
 */

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import {
  RedisService,
  CACHE_KEYS,
  CACHE_TTL,
} from '../../redis/services/redis.service';
import { CreateCommentDto } from '../dto/create-comment.dto';
import { UpdateCommentDto } from '../dto/update-comment.dto';
import { Role } from '../../../common/constants/roles';
import { Prisma } from '@prisma/client';
import { checkReview } from '../../contracts/utils/contract-rules';
import { ContractEventsService } from '../../contracts/services/contract-events.service';
import {
  ContractStepService,
  ruleToHttp,
} from '../../contracts/services/contract-step.service';

const ALREADY_REVIEWED = 'You already reviewed this contract.';

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    private steps: ContractStepService,
    private events: ContractEventsService,
  ) {}

  /**
   * The client reviews a finished contract (COMPLETED, or ENDED with approved work), once.
   * The contract row is locked first so its state cannot change while we check it.
   * The service (job) comes from the contract. After the save, the freelancer is told.
   */
  async create(createDto: CreateCommentDto, userId: number) {
    const { comment, contract } = await this.prisma.$transaction(async (tx) => {
      const contract = await this.steps.lockContract(tx, createDto.contractId);
      ruleToHttp(() => checkReview(contract, userId));

      const existing = await tx.comment.findUnique({
        where: { contractId: contract.id },
        select: { id: true },
      });
      if (existing) throw new ConflictException(ALREADY_REVIEWED);

      const comment = await this.createReview(tx, createDto, contract, userId);
      await this.events.record(tx, {
        contractId: contract.id,
        actorId: userId,
        type: 'review_left',
        data: { rating: createDto.rating },
      });
      return { comment, contract };
    });

    // After the save: tell the freelancer and refresh the caches (never inside the transaction).
    await this.events.announce({
      recipientId: contract.freelancerId,
      actorId: userId,
      actorName: contract.client.name,
      kind: 'contract',
      step: 'review_left',
      jobTitle: comment.job.title,
      title: 'New review',
      body: `${contract.client.name} reviewed ${contract.title} (${createDto.rating}/5).`,
      contractId: contract.id,
      recipientSide: 'freelancer',
    });
    await this.redisService.invalidateCommentCaches(contract.jobId);
    await this.redisService.invalidateUserCaches(comment.job.creatorId);

    return {
      message: 'Comment created successfully',
      content: comment,
    };
  }

  // GET /api/comments — Admin table: up to 100 reviews (comments on services).
  // Query: comment.findMany
  async findAll() {
    const comments = await this.prisma.comment.findMany({
      take: 100,
      include: {
        job: true,
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        commentedAt: 'desc',
      },
    });

    return {
      message: 'Get comments successfully',
      content: comments,
    };
  }

  private async createReview(
    tx: Prisma.TransactionClient,
    createDto: CreateCommentDto,
    contract: { id: number; jobId: number },
    userId: number,
  ) {
    try {
      return await tx.comment.create({
        data: {
          contractId: contract.id,
          jobId: contract.jobId,
          commenterId: userId,
          content: createDto.content,
          rating: createDto.rating,
        },
        include: {
          job: true,
          user: {
            select: {
              id: true,
              name: true,
              avatar: true,
            },
          },
        },
      });
    } catch (error) {
      // Two reviews at the same moment: the unique contractId lets only one in.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(ALREADY_REVIEWED);
      }
      throw error;
    }
  }

  async findOne(id: number) {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      include: {
        job: true,
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }

    return {
      message: 'Get comment successfully',
      content: comment,
    };
  }

  // PUT /api/comments/:id — Author (or admin) edits a review; clears review and user caches.
  // Query: comment.findUnique, comment.update
  async update(
    id: number,
    updateDto: UpdateCommentDto,
    userId: number,
    userRole: Role,
  ) {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      include: {
        job: {
          select: {
            creatorId: true,
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }

    if (comment.commenterId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const updated = await this.prisma.comment.update({
      where: { id },
      data: updateDto,
      include: {
        job: true,
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    // Invalidate comment caches
    await this.redisService.invalidateCommentCaches(comment.jobId);
    await this.redisService.invalidateUserCaches(comment.job.creatorId);

    return {
      message: 'Comment updated successfully',
      content: updated,
    };
  }

  // DELETE /api/comments/:id — Author (or admin) deletes a review; clears review and user caches.
  // Query: comment.findUnique, comment.delete
  async remove(id: number, userId: number, userRole: Role) {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
      include: {
        job: {
          select: {
            creatorId: true,
          },
        },
      },
    });

    if (!comment) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }

    if (comment.commenterId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    await this.prisma.comment.delete({
      where: { id },
    });

    // Invalidate comment caches
    await this.redisService.invalidateCommentCaches(comment.jobId);
    await this.redisService.invalidateUserCaches(comment.job.creatorId);

    return {
      message: 'Comment deleted successfully',
    };
  }

  // GET /api/comments/by-job/:jobId — Reviews of one service, kept in Redis.
  // Query: comment.findMany
  async findByJob(jobId: number) {
    const cacheKey = `${CACHE_KEYS.COMMENT_BY_JOB}${jobId}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const comments = await this.prisma.comment.findMany({
          where: { jobId },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatar: true,
              },
            },
          },
          orderBy: {
            commentedAt: 'desc',
          },
          take: 50,
        });

        return {
          message: 'Get comments by job successfully',
          content: comments,
        };
      },
      CACHE_TTL.SHORT, // 2 minutes for comments
    );
  }
}

import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService, CACHE_KEYS, CACHE_TTL } from '../../redis/redis.service';
import { CreateCommentDto } from '../dto/create-comment.dto';
import { UpdateCommentDto } from '../dto/update-comment.dto';
import { Role } from '../../../common/constants/roles';
import { Prisma } from '@prisma/client';

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async create(createDto: CreateCommentDto, userId: number) {
    const job = await this.prisma.job.findUnique({
      where: { id: createDto.jobId },
      select: { id: true, creatorId: true },
    });
    if (!job) {
      throw new NotFoundException(`Job with ID ${createDto.jobId} not found`);
    }
    if (job.creatorId === userId) {
      throw new BadRequestException('You cannot review your own service');
    }

    const completedHire = await this.prisma.hire.findFirst({
      where: { jobId: createDto.jobId, hirerId: userId, completed: true },
      select: { id: true },
    });
    if (!completedHire) {
      throw new ForbiddenException(
        'Complete a hire before reviewing this service',
      );
    }

    const existingReview = await this.prisma.comment.findFirst({
      where: { jobId: createDto.jobId, commenterId: userId },
      select: { id: true },
    });
    if (existingReview) {
      throw new ConflictException('You have already reviewed this service');
    }

    const comment = await this.createReview(createDto, userId);

    // Invalidate comment caches for the job
    await this.redisService.invalidateCommentCaches(createDto.jobId);
    await this.redisService.invalidateUserCaches(comment.job.creatorId);

    return {
      message: 'Comment created successfully',
      content: comment,
    };
  }

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

  private async createReview(createDto: CreateCommentDto, userId: number) {
    try {
      return await this.prisma.comment.create({
        data: {
          ...createDto,
          commenterId: userId,
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
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('You have already reviewed this service');
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

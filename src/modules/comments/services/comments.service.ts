import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService, CACHE_KEYS, CACHE_TTL } from '../../redis/redis.service';
import { CreateCommentDto } from '../dto/create-comment.dto';
import { UpdateCommentDto } from '../dto/update-comment.dto';
import { Role } from '../../../common/constants/roles';

@Injectable()
export class CommentsService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async create(createDto: CreateCommentDto, userId: number) {
    const comment = await this.prisma.comment.create({
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

    // Invalidate comment caches for the job
    await this.redisService.invalidateCommentCaches(createDto.jobId);

    return {
      message: 'Comment created successfully',
      content: comment,
    };
  }

  async findAll() {
    const comments = await this.prisma.comment.findMany({
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

    return {
      message: 'Comment updated successfully',
      content: updated,
    };
  }

  async remove(id: number, userId: number, userRole: Role) {
    const comment = await this.prisma.comment.findUnique({
      where: { id },
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

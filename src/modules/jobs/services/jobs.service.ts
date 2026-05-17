import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService, CACHE_KEYS, CACHE_TTL } from '../../redis/redis.service';
import { CreateJobDto } from '../dto/create-job.dto';
import { UpdateJobDto } from '../dto/update-job.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Role } from '../../../common/constants/roles';

@Injectable()
export class JobsService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async create(createDto: CreateJobDto, userId: number) {
    const job = await this.prisma.job.create({
      data: {
        title: createDto.title,
        price: createDto.price,
        image: createDto.image,
        description: createDto.description,
        shortDescription: createDto.shortDescription,
        reviews: createDto.reviews ?? 0,
        rating: createDto.rating ?? 0,
        subcategory: {
          connect: { id: createDto.subcategoryId },
        },
        user: {
          connect: { id: userId },
        },
      },
      include: {
        subcategory: {
          include: {
            category: true,
          },
        },
      },
    });

    // Invalidate job caches
    await this.redisService.invalidateJobCaches();

    return {
      message: 'Job created successfully',
      content: job,
    };
  }

  async findAll() {
    const cacheKey = `${CACHE_KEYS.JOB_LIST}all`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const jobs = await this.prisma.job.findMany({
          include: {
            subcategory: {
              include: {
                category: true,
              },
            },
          },
        });

        return {
          message: 'Get jobs successfully',
          content: jobs,
        };
      },
      CACHE_TTL.MEDIUM,
    );
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10, keyword } = paginationDto;
    const cacheKey = `${CACHE_KEYS.JOB_LIST}page:${page}:size:${pageSize}:keyword:${keyword || ''}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const skip = (page - 1) * pageSize;

        const where = keyword
          ? {
              title: { contains: keyword, mode: 'insensitive' as const },
            }
          : {};

        const [jobs, total] = await Promise.all([
          this.prisma.job.findMany({
            where,
            skip,
            take: pageSize,
            include: {
              subcategory: {
                include: {
                  category: true,
                },
              },
            },
            orderBy: { id: 'desc' },
          }),
          this.prisma.job.count({ where }),
        ]);

        return {
          message: 'Get jobs with pagination successfully',
          content: {
            data: jobs,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
          },
        };
      },
      CACHE_TTL.SHORT,
    );
  }

  async findOne(id: number) {
    const cacheKey = `${CACHE_KEYS.JOB_DETAIL}${id}`;

    const cached = await this.redisService.get<{
      message: string;
      content: unknown;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const job = await this.prisma.job.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        subcategory: {
          include: {
            category: true,
          },
        },
        comments: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatar: true,
              },
            },
          },
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    const result = {
      message: 'Get job successfully',
      content: job,
    };

    await this.redisService.set(cacheKey, result, CACHE_TTL.MEDIUM);
    return result;
  }

  async update(
    id: number,
    updateDto: UpdateJobDto,
    userId: number,
    userRole: Role,
  ) {
    const job = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    if (job.creatorId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only update your own jobs');
    }

    const updated = await this.prisma.job.update({
      where: { id },
      data: updateDto,
      include: {
        subcategory: {
          include: {
            category: true,
          },
        },
      },
    });

    // Invalidate job caches
    await this.redisService.invalidateJobCaches(id);

    return {
      message: 'Job updated successfully',
      content: updated,
    };
  }

  async remove(id: number, userId: number, userRole: Role) {
    const job = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    if (job.creatorId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only delete your own jobs');
    }

    await this.prisma.job.delete({
      where: { id },
    });

    // Invalidate job caches
    await this.redisService.invalidateJobCaches(id);

    return {
      message: 'Job deleted successfully',
    };
  }

  async uploadImage(
    id: number,
    filename: string,
    userId: number,
    userRole: Role,
  ) {
    const job = await this.prisma.job.findUnique({
      where: { id },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    if (job.creatorId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException(
        'You can only upload images for your own jobs',
      );
    }

    const updated = await this.prisma.job.update({
      where: { id },
      data: { image: filename },
    });

    // Invalidate job caches
    await this.redisService.invalidateJobCaches(id);

    return {
      message: 'Image uploaded successfully',
      content: updated,
    };
  }

  async getCategoryMenu() {
    return this.redisService.getOrSet(
      CACHE_KEYS.JOB_MENU,
      async () => {
        const categories = await this.prisma.category.findMany({
          include: {
            subcategories: true,
          },
        });

        return {
          message: 'Get menu job types successfully',
          content: categories,
        };
      },
      CACHE_TTL.VERY_LONG, // 24 hours - menu rarely changes
    );
  }

  async getSubcategoriesByCategory(categoryId: number) {
    const cacheKey = `${CACHE_KEYS.CATEGORY_DETAIL}${categoryId}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const subcategories =
          await this.prisma.subcategory.findMany({
            where: { categoryId },
            include: {
              category: true,
              jobs: true,
            },
          });

        return {
          message: 'Get job detail types successfully',
          content: subcategories,
        };
      },
      CACHE_TTL.LONG, // 1 hour
    );
  }

  async getJobsBySubcategory(subcategoryId: number) {
    const cacheKey = `${CACHE_KEYS.JOB_BY_CATEGORY}${subcategoryId}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const jobs = await this.prisma.job.findMany({
          where: { subcategoryId },
          include: {
            subcategory: {
              include: {
                category: true,
              },
            },
          },
        });

        return {
          message: 'Get jobs by detail type successfully',
          content: jobs,
        };
      },
      CACHE_TTL.MEDIUM, // 10 minutes
    );
  }

  async getJobDetails(jobId: number) {
    const cacheKey = `${CACHE_KEYS.JOB_DETAIL}full:${jobId}`;

    const cached = await this.redisService.get<{
      message: string;
      content: unknown;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        subcategory: {
          include: {
            category: true,
          },
        },
        comments: {
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
        },
      },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID ${jobId} not found`);
    }

    const result = {
      message: 'Get job detail successfully',
      content: job,
    };

    await this.redisService.set(cacheKey, result, CACHE_TTL.MEDIUM);
    return result;
  }

  async searchByName(title: string) {
    const cacheKey = `${CACHE_KEYS.JOB_SEARCH}${title.toLowerCase()}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const jobs = await this.prisma.job.findMany({
          where: {
            title: {
              contains: title,
              mode: 'insensitive' as const,
            },
          },
          include: {
            subcategory: {
              include: {
                category: true,
              },
            },
          },
        });

        return {
          message: 'Search jobs successfully',
          content: jobs,
        };
      },
      CACHE_TTL.SHORT, // 2 minutes for search results
    );
  }
}

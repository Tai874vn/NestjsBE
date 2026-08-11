import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { PrismaService } from '../../../prisma.service';
import { RedisService, CACHE_KEYS, CACHE_TTL } from '../../redis/redis.service';
import { JobCursorQueryDto } from '../dto/job-cursor-query.dto';
import { JobSearchQueryDto, JobSearchSort } from '../dto/job-search-query.dto';

type JobCursor = {
  createdAt: string;
  id: number;
};

@Injectable()
export class JobSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  async findAll() {
    const cacheKey = `${CACHE_KEYS.JOB_LIST}all:seller:v2`;

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
            user: { select: { id: true, name: true, avatar: true } },
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

  async findAllWithPagination(query: JobSearchQueryDto) {
    const { page = 1, pageSize = 10 } = query;
    const cacheKey = `${CACHE_KEYS.JOB_LIST}seller:v4:${this.jobSearchCacheKey(query)}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const skip = (page - 1) * pageSize;
        const where = this.buildJobSearchWhere(query);
        const orderBy = this.buildJobSearchOrderBy(query.sort);

        const [jobs, total] = await Promise.all([
          this.prisma.job.findMany({
            where,
            skip,
            take: pageSize,
            include: {
              user: { select: { id: true, name: true, avatar: true } },
              subcategory: {
                include: {
                  category: true,
                },
              },
            },
            orderBy,
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

  async findAllWithCursor(query: JobCursorQueryDto) {
    const limit = query.limit ?? 10;
    const cursor = this.decodeCursor(query.cursor);
    const cacheKey = `${CACHE_KEYS.JOB_LIST}cursor:v2:${this.jobSearchCacheKey(query)}:cursor:${query.cursor || 'first'}:limit:${limit}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const where = this.andJobWhere(
          this.buildJobSearchWhere(query),
          cursor
            ? {
                OR: [
                  { createdAt: { lt: new Date(cursor.createdAt) } },
                  {
                    createdAt: new Date(cursor.createdAt),
                    id: { lt: cursor.id },
                  },
                ],
              }
            : {},
        );

        const rows = await this.prisma.job.findMany({
          where,
          take: limit + 1,
          include: {
            user: { select: { id: true, name: true, avatar: true } },
            subcategory: {
              include: {
                category: true,
              },
            },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);

        return {
          message: 'Get jobs with cursor successfully',
          content: {
            data: page,
            nextCursor:
              hasMore && page.length
                ? this.encodeCursor({
                    createdAt: page[page.length - 1].createdAt.toISOString(),
                    id: page[page.length - 1].id,
                  })
                : null,
          },
        };
      },
      CACHE_TTL.SHORT,
    );
  }

  async findByCreator(creatorId: number, paginationDto: PaginationDto) {
    const { page = 1, pageSize = 20 } = paginationDto;
    const where = { creatorId };
    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, name: true, avatar: true } },
          subcategory: { include: { category: true } },
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.job.count({ where }),
    ]);

    return {
      message: 'Get creator jobs successfully',
      content: {
        data: jobs,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
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
      CACHE_TTL.SHORT,
    );
  }

  private buildJobSearchWhere(query: JobSearchQueryDto): Prisma.JobWhereInput {
    const filters: Prisma.JobWhereInput[] = [];
    const keyword = query.keyword?.trim();

    if (keyword) {
      filters.push({
        OR: [
          { title: { contains: keyword, mode: 'insensitive' } },
          { shortDescription: { contains: keyword, mode: 'insensitive' } },
          { description: { contains: keyword, mode: 'insensitive' } },
          { user: { name: { contains: keyword, mode: 'insensitive' } } },
          { subcategory: { name: { contains: keyword, mode: 'insensitive' } } },
          {
            subcategory: {
              category: { name: { contains: keyword, mode: 'insensitive' } },
            },
          },
        ],
      });
    }

    if (query.subcategoryId) {
      filters.push({ subcategoryId: query.subcategoryId });
    } else if (query.categoryId) {
      filters.push({ subcategory: { categoryId: query.categoryId } });
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      filters.push({
        price: {
          ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
          ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
        },
      });
    }

    if (query.minRating !== undefined) {
      filters.push({ rating: { gte: query.minRating } });
    }

    return this.andJobWhere(...filters);
  }

  private andJobWhere(
    ...filters: Prisma.JobWhereInput[]
  ): Prisma.JobWhereInput {
    const activeFilters = filters.filter(
      (filter) => Object.keys(filter).length > 0,
    );
    return activeFilters.length ? { AND: activeFilters } : {};
  }

  private buildJobSearchOrderBy(
    sort?: JobSearchSort,
  ): Prisma.JobOrderByWithRelationInput[] {
    if (sort === 'price_asc') {
      return [{ price: 'asc' }, { id: 'desc' }];
    }
    if (sort === 'price_desc') {
      return [{ price: 'desc' }, { id: 'desc' }];
    }
    if (sort === 'rating_desc') {
      return [{ rating: 'desc' }, { reviews: 'desc' }, { id: 'desc' }];
    }
    if (sort === 'newest') {
      return [{ createdAt: 'desc' }, { id: 'desc' }];
    }
    return [{ id: 'desc' }];
  }

  private jobSearchCacheKey(query: JobSearchQueryDto): string {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    return [
      `page:${page}`,
      `size:${pageSize}`,
      `keyword:${query.keyword?.trim() || ''}`,
      `category:${query.categoryId ?? ''}`,
      `subcategory:${query.subcategoryId ?? ''}`,
      `minPrice:${query.minPrice ?? ''}`,
      `maxPrice:${query.maxPrice ?? ''}`,
      `minRating:${query.minRating ?? ''}`,
      `sort:${query.sort ?? ''}`,
    ].join(':');
  }

  private encodeCursor(cursor: JobCursor) {
    return Buffer.from(JSON.stringify(cursor)).toString('base64url');
  }

  private decodeCursor(value?: string): JobCursor | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(
        Buffer.from(value, 'base64url').toString('utf8'),
      ) as JobCursor;
      if (
        !Number.isInteger(parsed.id) ||
        !parsed.createdAt ||
        Number.isNaN(new Date(parsed.createdAt).getTime())
      ) {
        throw new Error('invalid');
      }
      return parsed;
    } catch {
      throw new BadRequestException('Invalid jobs cursor');
    }
  }
}

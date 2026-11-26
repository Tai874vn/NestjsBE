import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { PrismaService } from '../../../prisma.service';
import {
  RedisService,
  CACHE_KEYS,
  CACHE_TTL,
} from '../../redis/services/redis.service';
import { JobCursorQueryDto } from '../dto/job-cursor-query.dto';
import {
  JOB_SEARCH_FIELDS,
  JobSearchField,
  JobSearchQueryDto,
  JobSearchSort,
} from '../dto/job-search-query.dto';

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
          take: 100,
          orderBy: { id: 'desc' },
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
    const load = async () => {
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
    };

    // Only cache unfiltered pages 1-5 with the default sort to prevent unbounded cache keys.
    if (!this.isCacheableListPage(query, page)) {
      return load();
    }

    const cacheKey = `${CACHE_KEYS.JOB_LIST}seller:v4:page:${page}:size:${pageSize}`;
    return this.redisService.getOrSet(cacheKey, load, CACHE_TTL.SHORT);
  }

  async findAllWithCursor(query: JobCursorQueryDto) {
    const limit = query.limit ?? 10;
    const cursor = this.decodeCursor(query.cursor);
    const load = async () => {
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
    };

    // Only cache the first unfiltered cursor page with default sort.
    if (cursor || !this.isUnfilteredDefaultSort(query)) {
      return load();
    }

    const cacheKey = `${CACHE_KEYS.JOB_LIST}cursor:v2:first:limit:${limit}`;
    return this.redisService.getOrSet(cacheKey, load, CACHE_TTL.SHORT);
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
          take: 5,
          orderBy: { commentedAt: 'desc' },
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
          take: 5,
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
    // Free-text searches have unbounded cardinality, so query PostgreSQL directly.
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
      take: 50,
    });

    return {
      message: 'Search jobs successfully',
      content: jobs,
    };
  }

  private buildJobSearchWhere(query: JobSearchQueryDto): Prisma.JobWhereInput {
    const filters: Prisma.JobWhereInput[] = [];
    const keyword = query.keyword?.trim();

    // @find jobs search keyword-fields logic [all] — how each field is searched; the frontend picks with searchIn
    if (keyword) {
      const has = { contains: keyword, mode: 'insensitive' as const };
      const byField: Record<JobSearchField, Prisma.JobWhereInput> = {
        title: { title: has },
        shortDescription: { shortDescription: has },
        description: { description: has },
        sellerName: { user: { name: has } },
        subcategory: { subcategory: { name: has } },
        category: { subcategory: { category: { name: has } } },
      };
      const fields = query.searchIn ?? JOB_SEARCH_FIELDS;
      filters.push({ OR: fields.map((field) => byField[field]) });
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

  private isCacheableListPage(query: JobSearchQueryDto, page: number): boolean {
    return page >= 1 && page <= 5 && this.isUnfilteredDefaultSort(query);
  }

  private isUnfilteredDefaultSort(query: JobSearchQueryDto): boolean {
    return (
      !query.keyword?.trim() &&
      query.categoryId === undefined &&
      query.subcategoryId === undefined &&
      query.minPrice === undefined &&
      query.maxPrice === undefined &&
      query.minRating === undefined &&
      query.sort === undefined
    );
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

import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService, CACHE_KEYS, CACHE_TTL } from '../../redis/redis.service';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async create(createDto: CreateCategoryDto) {
    const category = await this.prisma.category.create({
      data: createDto,
    });

    // Invalidate category caches
    await this.redisService.invalidateCategoryCaches();

    return {
      message: 'Job type created successfully',
      content: category,
    };
  }

  async findAll() {
    return this.redisService.getOrSet(
      CACHE_KEYS.CATEGORY_LIST,
      async () => {
        const categories = await this.prisma.category.findMany({
          include: {
            subcategories: true,
          },
        });

        return {
          message: 'Get job types successfully',
          content: categories,
        };
      },
      CACHE_TTL.LONG, // 1 hour
    );
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10, keyword } = paginationDto;
    const skip = (page - 1) * pageSize;

    const where = keyword
      ? {
          name: { contains: keyword, mode: 'insensitive' as const },
        }
      : {};

    const [categories, total] = await Promise.all([
      this.prisma.category.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          subcategories: true,
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.category.count({ where }),
    ]);

    return {
      message: 'Get job types with pagination successfully',
      content: {
        data: categories,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: number) {
    const cacheKey = `${CACHE_KEYS.CATEGORY}${id}`;

    const cached = await this.redisService.get<{
      message: string;
      content: unknown;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        subcategories: true,
      },
    });

    if (!category) {
      throw new NotFoundException(`Job type with ID ${id} not found`);
    }

    const result = {
      message: 'Get job type successfully',
      content: category,
    };

    await this.redisService.set(cacheKey, result, CACHE_TTL.LONG);
    return result;
  }

  async update(id: number, updateDto: UpdateCategoryDto) {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException(`Job type with ID ${id} not found`);
    }

    const updated = await this.prisma.category.update({
      where: { id },
      data: updateDto,
      include: {
        subcategories: true,
      },
    });

    // Invalidate category caches
    await this.redisService.invalidateCategoryCaches(id);

    return {
      message: 'Job type updated successfully',
      content: updated,
    };
  }

  async remove(id: number) {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException(`Job type with ID ${id} not found`);
    }

    await this.prisma.category.delete({
      where: { id },
    });

    // Invalidate category caches
    await this.redisService.invalidateCategoryCaches(id);

    return {
      message: 'Job type deleted successfully',
    };
  }
}

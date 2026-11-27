/**
 * Service for the categories module.
 * It creates, reads, paginates, updates, and deletes job categories, keeping category caches in Redis and removing deleted subcategory images.
 *
 * Calls: prisma.category; RedisService; StorageService
 * Used by:
 *   - src/modules/categories/categories.module.ts
 *   - src/modules/categories/controllers/categories.controller.ts
 */

import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import {
  RedisService,
  CACHE_KEYS,
  CACHE_TTL,
} from '../../redis/services/redis.service';
import { CreateCategoryDto } from '../dto/create-category.dto';
import { UpdateCategoryDto } from '../dto/update-category.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { StorageService } from '../../storage/services/storage.service';

@Injectable()
export class CategoriesService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  // POST /api/categories — Admin adds a job type (category).
  // Query: category.create
  async create(createDto: CreateCategoryDto) {
    const category = await this.prisma.category.create({
      data: createDto,
    });

    // Invalidate category caches
    await this.redisService.invalidateCategoryCaches();

    return {
      message: 'Category created successfully',
      content: category,
    };
  }

  // GET /api/categories — Every category, kept in Redis.
  // Query: category.findMany
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
          message: 'Get categories successfully',
          content: categories,
        };
      },
      CACHE_TTL.LONG, // 1 hour
    );
  }

  // GET /api/categories/paginated-search — Admin table: categories by page, with keyword search.
  // Query: category.findMany, category.count
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
      message: 'Get categories with pagination successfully',
      content: {
        data: categories,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  // GET /api/categories/:id — One category (Redis first).
  // Query: category.findUnique
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
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    const result = {
      message: 'Get job type successfully',
      content: category,
    };

    await this.redisService.set(cacheKey, result, CACHE_TTL.LONG);
    return result;
  }

  // PUT /api/categories/:id — Admin renames a category; clears the category caches.
  // Query: category.findUnique, category.update
  async update(id: number, updateDto: UpdateCategoryDto) {
    const category = await this.prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
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
      message: 'Category updated successfully',
      content: updated,
    };
  }

  // DELETE /api/categories/:id — Admin deletes a category; clears the category caches.
  // Query: category.findUnique, category.delete
  async remove(id: number) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        subcategories: { select: { image: true } },
      },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    await this.prisma.category.delete({
      where: { id },
    });

    // Clean up local images of subcategories removed by the cascade.
    for (const subcategory of category.subcategories ?? []) {
      if (subcategory.image) {
        await this.storage?.deleteImage(subcategory.image);
      }
    }

    // Invalidate category caches
    await this.redisService.invalidateCategoryCaches(id);

    return {
      message: 'Category deleted successfully',
    };
  }
}

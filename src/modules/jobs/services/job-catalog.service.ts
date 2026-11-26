import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import {
  RedisService,
  CACHE_KEYS,
  CACHE_TTL,
} from '../../redis/services/redis.service';

@Injectable()
export class JobCatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

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
          message: 'Get category menu successfully',
          content: categories,
        };
      },
      CACHE_TTL.VERY_LONG,
    );
  }

  async getSubcategoriesByCategory(categoryId: number) {
    const cacheKey = `${CACHE_KEYS.CATEGORY_DETAIL}${categoryId}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const subcategories = await this.prisma.subcategory.findMany({
          where: { categoryId },
          include: {
            category: true,
            _count: { select: { jobs: true } },
          },
        });

        return {
          message: 'Get subcategories successfully',
          content: subcategories,
        };
      },
      CACHE_TTL.LONG,
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
      CACHE_TTL.MEDIUM,
    );
  }
}

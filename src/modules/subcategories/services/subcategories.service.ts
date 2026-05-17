import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CreateSubcategoryDto } from '../dto/create-subcategory.dto';
import { UpdateSubcategoryDto } from '../dto/update-subcategory.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';

@Injectable()
export class SubcategoriesService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async create(createDto: CreateSubcategoryDto) {
    const subcategory = await this.prisma.subcategory.create({
      data: createDto,
      include: {
        category: true,
      },
    });

    // Invalidate category caches (affects menu and category details)
    await this.redisService.invalidateCategoryCaches(createDto.categoryId);

    return {
      message: 'Job detail type created successfully',
      content: subcategory,
    };
  }

  async findAll() {
    const subcategories = await this.prisma.subcategory.findMany(
      {
        include: {
          category: true,
          jobs: true,
        },
      },
    );

    return {
      message: 'Get job detail types successfully',
      content: subcategories,
    };
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10, keyword } = paginationDto;
    const skip = (page - 1) * pageSize;

    const where = keyword
      ? {
          name: { contains: keyword, mode: 'insensitive' as const },
        }
      : {};

    const [subcategories, total] = await Promise.all([
      this.prisma.subcategory.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          category: true,
          jobs: true,
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.subcategory.count({ where }),
    ]);

    return {
      message: 'Get job detail types with pagination successfully',
      content: {
        data: subcategories,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: number) {
    const subcategory =
      await this.prisma.subcategory.findUnique({
        where: { id },
        include: {
          category: true,
          jobs: true,
        },
      });

    if (!subcategory) {
      throw new NotFoundException(`Job detail type with ID ${id} not found`);
    }

    return {
      message: 'Get job detail type successfully',
      content: subcategory,
    };
  }

  async update(id: number, updateDto: UpdateSubcategoryDto) {
    const subcategory =
      await this.prisma.subcategory.findUnique({
        where: { id },
      });

    if (!subcategory) {
      throw new NotFoundException(`Job detail type with ID ${id} not found`);
    }

    const updated = await this.prisma.subcategory.update({
      where: { id },
      data: updateDto,
      include: {
        category: true,
        jobs: true,
      },
    });

    // Invalidate category caches
    await this.redisService.invalidateCategoryCaches(
      subcategory.categoryId,
    );

    return {
      message: 'Job detail type updated successfully',
      content: updated,
    };
  }

  async remove(id: number) {
    const subcategory =
      await this.prisma.subcategory.findUnique({
        where: { id },
      });

    if (!subcategory) {
      throw new NotFoundException(`Job detail type with ID ${id} not found`);
    }

    await this.prisma.subcategory.delete({
      where: { id },
    });

    // Invalidate category caches
    await this.redisService.invalidateCategoryCaches(
      subcategory.categoryId,
    );

    return {
      message: 'Job detail type deleted successfully',
    };
  }

  async uploadImage(id: number, filename: string) {
    const subcategory =
      await this.prisma.subcategory.findUnique({
        where: { id },
      });

    if (!subcategory) {
      throw new NotFoundException(`Job detail type with ID ${id} not found`);
    }

    const updated = await this.prisma.subcategory.update({
      where: { id },
      data: { image: filename },
    });

    // Invalidate category caches
    await this.redisService.invalidateCategoryCaches(
      subcategory.categoryId,
    );

    return {
      message: 'Image uploaded successfully',
      content: updated,
    };
  }
}

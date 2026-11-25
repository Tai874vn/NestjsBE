import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CreateSubcategoryDto } from '../dto/create-subcategory.dto';
import { UpdateSubcategoryDto } from '../dto/update-subcategory.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class SubcategoriesService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    @Optional() private readonly storage?: StorageService,
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
      message: 'Subcategory created successfully',
      content: subcategory,
    };
  }

  async findAll() {
    const subcategories = await this.prisma.subcategory.findMany({
      include: {
        category: true,
      },
    });

    return {
      message: 'Get subcategories successfully',
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
          _count: { select: { jobs: true } },
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.subcategory.count({ where }),
    ]);

    return {
      message: 'Get subcategories with pagination successfully',
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
    const subcategory = await this.prisma.subcategory.findUnique({
      where: { id },
      include: {
        category: true,
        _count: { select: { jobs: true } },
      },
    });

    if (!subcategory) {
      throw new NotFoundException(`Subcategory with ID ${id} not found`);
    }

    return {
      message: 'Get job detail type successfully',
      content: subcategory,
    };
  }

  async update(id: number, updateDto: UpdateSubcategoryDto) {
    const subcategory = await this.prisma.subcategory.findUnique({
      where: { id },
    });

    if (!subcategory) {
      throw new NotFoundException(`Subcategory with ID ${id} not found`);
    }

    const updated = await this.prisma.subcategory.update({
      where: { id },
      data: updateDto,
      include: {
        category: true,
        _count: { select: { jobs: true } },
      },
    });

    // Clean up an old local image when the update replaces or clears it.
    if (
      updateDto.image !== undefined &&
      subcategory.image &&
      subcategory.image !== updated.image
    ) {
      await this.storage?.deleteImage(subcategory.image);
    }

    // Invalidate both the old and new category caches if the subcategory moved.
    const nextCategoryId = updateDto.categoryId ?? updated.categoryId;
    await this.redisService.invalidateCategoryCaches(subcategory.categoryId);
    if (nextCategoryId && nextCategoryId !== subcategory.categoryId) {
      await this.redisService.invalidateCategoryCaches(nextCategoryId);
    }

    return {
      message: 'Subcategory updated successfully',
      content: updated,
    };
  }

  async remove(id: number) {
    const subcategory = await this.prisma.subcategory.findUnique({
      where: { id },
    });

    if (!subcategory) {
      throw new NotFoundException(`Subcategory with ID ${id} not found`);
    }

    await this.prisma.subcategory.delete({
      where: { id },
    });

    if (subcategory.image) {
      await this.storage?.deleteImage(subcategory.image);
    }

    // Invalidate category caches
    await this.redisService.invalidateCategoryCaches(subcategory.categoryId);

    return {
      message: 'Subcategory deleted successfully',
    };
  }

  async uploadImage(id: number, filename: string) {
    const subcategory = await this.prisma.subcategory.findUnique({
      where: { id },
    });

    if (!subcategory) {
      throw new NotFoundException(`Subcategory with ID ${id} not found`);
    }

    const updated = await this.prisma.subcategory.update({
      where: { id },
      data: { image: filename },
    });

    if (subcategory.image && subcategory.image !== filename) {
      await this.storage?.deleteImage(subcategory.image);
    }

    // Invalidate category caches
    await this.redisService.invalidateCategoryCaches(subcategory.categoryId);

    return {
      message: 'Image uploaded successfully',
      content: updated,
    };
  }
}

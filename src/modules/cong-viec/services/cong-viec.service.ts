import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService, CACHE_KEYS, CACHE_TTL } from '../../redis/redis.service';
import { CreateCongViecDto } from '../dto/create-cong-viec.dto';
import { UpdateCongViecDto } from '../dto/update-cong-viec.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Role } from '../../../common/constants/roles';

@Injectable()
export class CongViecService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async create(createDto: CreateCongViecDto, userId: number) {
    const congViec = await this.prisma.congViec.create({
      data: {
        tenCongViec: createDto.tenCongViec,
        giaTien: createDto.giaTien,
        hinhAnh: createDto.hinhAnh,
        moTa: createDto.moTa,
        moTaNgan: createDto.moTaNgan,
        danhGia: createDto.danhGia ?? 0,
        saoCongViec: createDto.saoCongViec ?? 0,
        chiTietLoaiCongViec: {
          connect: { id: createDto.maChiTietLoai },
        },
        nguoiDung: {
          connect: { id: userId },
        },
      },
      include: {
        chiTietLoaiCongViec: {
          include: {
            loaiCongViec: true,
          },
        },
      },
    });

    // Invalidate job caches
    await this.redisService.invalidateJobCaches();

    return {
      message: 'Job created successfully',
      content: congViec,
    };
  }

  async findAll() {
    const cacheKey = `${CACHE_KEYS.JOB_LIST}all`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const congViecs = await this.prisma.congViec.findMany({
          include: {
            chiTietLoaiCongViec: {
              include: {
                loaiCongViec: true,
              },
            },
          },
        });

        return {
          message: 'Get jobs successfully',
          content: congViecs,
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
              tenCongViec: { contains: keyword, mode: 'insensitive' as const },
            }
          : {};

        const [congViecs, total] = await Promise.all([
          this.prisma.congViec.findMany({
            where,
            skip,
            take: pageSize,
            include: {
              chiTietLoaiCongViec: {
                include: {
                  loaiCongViec: true,
                },
              },
            },
            orderBy: { id: 'desc' },
          }),
          this.prisma.congViec.count({ where }),
        ]);

        return {
          message: 'Get jobs with pagination successfully',
          content: {
            data: congViecs,
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

    const congViec = await this.prisma.congViec.findUnique({
      where: { id },
      include: {
        nguoiDung: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        chiTietLoaiCongViec: {
          include: {
            loaiCongViec: true,
          },
        },
        binhLuans: {
          include: {
            nguoiDung: {
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

    if (!congViec) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    const result = {
      message: 'Get job successfully',
      content: congViec,
    };

    await this.redisService.set(cacheKey, result, CACHE_TTL.MEDIUM);
    return result;
  }

  async update(
    id: number,
    updateDto: UpdateCongViecDto,
    userId: number,
    userRole: Role,
  ) {
    const congViec = await this.prisma.congViec.findUnique({
      where: { id },
    });

    if (!congViec) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    if (congViec.nguoiTao !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only update your own jobs');
    }

    const updated = await this.prisma.congViec.update({
      where: { id },
      data: updateDto,
      include: {
        chiTietLoaiCongViec: {
          include: {
            loaiCongViec: true,
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
    const congViec = await this.prisma.congViec.findUnique({
      where: { id },
    });

    if (!congViec) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    if (congViec.nguoiTao !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only delete your own jobs');
    }

    await this.prisma.congViec.delete({
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
    const congViec = await this.prisma.congViec.findUnique({
      where: { id },
    });

    if (!congViec) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    if (congViec.nguoiTao !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException(
        'You can only upload images for your own jobs',
      );
    }

    const updated = await this.prisma.congViec.update({
      where: { id },
      data: { hinhAnh: filename },
    });

    // Invalidate job caches
    await this.redisService.invalidateJobCaches(id);

    return {
      message: 'Image uploaded successfully',
      content: updated,
    };
  }

  async getMenuLoaiCongViec() {
    return this.redisService.getOrSet(
      CACHE_KEYS.JOB_MENU,
      async () => {
        const loaiCongViecs = await this.prisma.loaiCongViec.findMany({
          include: {
            chiTietLoaiCongViecs: true,
          },
        });

        return {
          message: 'Get menu job types successfully',
          content: loaiCongViecs,
        };
      },
      CACHE_TTL.VERY_LONG, // 24 hours - menu rarely changes
    );
  }

  async getChiTietLoaiCongViec(maLoaiCongViec: number) {
    const cacheKey = `${CACHE_KEYS.CATEGORY_DETAIL}${maLoaiCongViec}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const chiTietLoaiCongViecs =
          await this.prisma.chiTietLoaiCongViec.findMany({
            where: { maLoaiCongViec },
            include: {
              loaiCongViec: true,
              congViecs: true,
            },
          });

        return {
          message: 'Get job detail types successfully',
          content: chiTietLoaiCongViecs,
        };
      },
      CACHE_TTL.LONG, // 1 hour
    );
  }

  async getCongViecByChiTietLoai(maChiTietLoai: number) {
    const cacheKey = `${CACHE_KEYS.JOB_BY_CATEGORY}${maChiTietLoai}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const congViecs = await this.prisma.congViec.findMany({
          where: { maChiTietLoai },
          include: {
            chiTietLoaiCongViec: {
              include: {
                loaiCongViec: true,
              },
            },
          },
        });

        return {
          message: 'Get jobs by detail type successfully',
          content: congViecs,
        };
      },
      CACHE_TTL.MEDIUM, // 10 minutes
    );
  }

  async getCongViecChiTiet(maCongViec: number) {
    const cacheKey = `${CACHE_KEYS.JOB_DETAIL}full:${maCongViec}`;

    const cached = await this.redisService.get<{
      message: string;
      content: unknown;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const congViec = await this.prisma.congViec.findUnique({
      where: { id: maCongViec },
      include: {
        nguoiDung: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
        chiTietLoaiCongViec: {
          include: {
            loaiCongViec: true,
          },
        },
        binhLuans: {
          include: {
            nguoiDung: {
              select: {
                id: true,
                name: true,
                avatar: true,
              },
            },
          },
          orderBy: {
            ngayBinhLuan: 'desc',
          },
        },
      },
    });

    if (!congViec) {
      throw new NotFoundException(`Job with ID ${maCongViec} not found`);
    }

    const result = {
      message: 'Get job detail successfully',
      content: congViec,
    };

    await this.redisService.set(cacheKey, result, CACHE_TTL.MEDIUM);
    return result;
  }

  async searchByName(tenCongViec: string) {
    const cacheKey = `${CACHE_KEYS.JOB_SEARCH}${tenCongViec.toLowerCase()}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const congViecs = await this.prisma.congViec.findMany({
          where: {
            tenCongViec: {
              contains: tenCongViec,
              mode: 'insensitive' as const,
            },
          },
          include: {
            chiTietLoaiCongViec: {
              include: {
                loaiCongViec: true,
              },
            },
          },
        });

        return {
          message: 'Search jobs successfully',
          content: congViecs,
        };
      },
      CACHE_TTL.SHORT, // 2 minutes for search results
    );
  }
}

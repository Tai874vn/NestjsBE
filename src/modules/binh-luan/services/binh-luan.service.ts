import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import {
  RedisService,
  CACHE_KEYS,
  CACHE_TTL,
} from '../../redis/redis.service';
import { CreateBinhLuanDto } from '../dto/create-binh-luan.dto';
import { UpdateBinhLuanDto } from '../dto/update-binh-luan.dto';
import { Role } from '../../../common/constants/roles';

@Injectable()
export class BinhLuanService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async create(createDto: CreateBinhLuanDto, userId: number) {
    const binhLuan = await this.prisma.binhLuan.create({
      data: {
        ...createDto,
        maNguoiBinhLuan: userId,
      },
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    // Invalidate comment caches for the job
    await this.redisService.invalidateCommentCaches(createDto.maCongViec);

    return {
      message: 'Comment created successfully',
      content: binhLuan,
    };
  }

  async findAll() {
    const binhLuans = await this.prisma.binhLuan.findMany({
      include: {
        congViec: true,
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
    });

    return {
      message: 'Get comments successfully',
      content: binhLuans,
    };
  }

  async findOne(id: number) {
    const binhLuan = await this.prisma.binhLuan.findUnique({
      where: { id },
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    if (!binhLuan) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }

    return {
      message: 'Get comment successfully',
      content: binhLuan,
    };
  }

  async update(id: number, updateDto: UpdateBinhLuanDto, userId: number, userRole: string) {
    const binhLuan = await this.prisma.binhLuan.findUnique({
      where: { id },
    });

    if (!binhLuan) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }

    if (binhLuan.maNguoiBinhLuan !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const updated = await this.prisma.binhLuan.update({
      where: { id },
      data: updateDto,
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            avatar: true,
          },
        },
      },
    });

    // Invalidate comment caches
    await this.redisService.invalidateCommentCaches(binhLuan.maCongViec);

    return {
      message: 'Comment updated successfully',
      content: updated,
    };
  }

  async remove(id: number, userId: number, userRole: string) {
    const binhLuan = await this.prisma.binhLuan.findUnique({
      where: { id },
    });

    if (!binhLuan) {
      throw new NotFoundException(`Comment with ID ${id} not found`);
    }

    if (binhLuan.maNguoiBinhLuan !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only delete your own comments');
    }

    await this.prisma.binhLuan.delete({
      where: { id },
    });

    // Invalidate comment caches
    await this.redisService.invalidateCommentCaches(binhLuan.maCongViec);

    return {
      message: 'Comment deleted successfully',
    };
  }

  async findByJob(maCongViec: number) {
    const cacheKey = `${CACHE_KEYS.COMMENT_BY_JOB}${maCongViec}`;

    return this.redisService.getOrSet(
      cacheKey,
      async () => {
        const binhLuans = await this.prisma.binhLuan.findMany({
          where: { maCongViec },
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
        });

        return {
          message: 'Get comments by job successfully',
          content: binhLuans,
        };
      },
      CACHE_TTL.SHORT, // 2 minutes for comments
    );
  }
}

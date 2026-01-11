import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { CreateChiTietLoaiCongViecDto } from '../dto/create-chi-tiet-loai-cong-viec.dto';
import { UpdateChiTietLoaiCongViecDto } from '../dto/update-chi-tiet-loai-cong-viec.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';

@Injectable()
export class ChiTietLoaiCongViecService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateChiTietLoaiCongViecDto) {
    const chiTietLoaiCongViec = await this.prisma.chiTietLoaiCongViec.create({
      data: createDto,
      include: {
        loaiCongViec: true,
      },
    });

    return {
      message: 'Job detail type created successfully',
      content: chiTietLoaiCongViec,
    };
  }

  async findAll() {
    const chiTietLoaiCongViecs = await this.prisma.chiTietLoaiCongViec.findMany(
      {
        include: {
          loaiCongViec: true,
          congViecs: true,
        },
      },
    );

    return {
      message: 'Get job detail types successfully',
      content: chiTietLoaiCongViecs,
    };
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10, keyword } = paginationDto;
    const skip = (page - 1) * pageSize;

    const where = keyword
      ? {
          tenChiTiet: { contains: keyword, mode: 'insensitive' as const },
        }
      : {};

    const [chiTietLoaiCongViecs, total] = await Promise.all([
      this.prisma.chiTietLoaiCongViec.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          loaiCongViec: true,
          congViecs: true,
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.chiTietLoaiCongViec.count({ where }),
    ]);

    return {
      message: 'Get job detail types with pagination successfully',
      content: {
        data: chiTietLoaiCongViecs,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: number) {
    const chiTietLoaiCongViec =
      await this.prisma.chiTietLoaiCongViec.findUnique({
        where: { id },
        include: {
          loaiCongViec: true,
          congViecs: true,
        },
      });

    if (!chiTietLoaiCongViec) {
      throw new NotFoundException(`Job detail type with ID ${id} not found`);
    }

    return {
      message: 'Get job detail type successfully',
      content: chiTietLoaiCongViec,
    };
  }

  async update(id: number, updateDto: UpdateChiTietLoaiCongViecDto) {
    const chiTietLoaiCongViec =
      await this.prisma.chiTietLoaiCongViec.findUnique({
        where: { id },
      });

    if (!chiTietLoaiCongViec) {
      throw new NotFoundException(`Job detail type with ID ${id} not found`);
    }

    const updated = await this.prisma.chiTietLoaiCongViec.update({
      where: { id },
      data: updateDto,
      include: {
        loaiCongViec: true,
        congViecs: true,
      },
    });

    return {
      message: 'Job detail type updated successfully',
      content: updated,
    };
  }

  async remove(id: number) {
    const chiTietLoaiCongViec =
      await this.prisma.chiTietLoaiCongViec.findUnique({
        where: { id },
      });

    if (!chiTietLoaiCongViec) {
      throw new NotFoundException(`Job detail type with ID ${id} not found`);
    }

    await this.prisma.chiTietLoaiCongViec.delete({
      where: { id },
    });

    return {
      message: 'Job detail type deleted successfully',
    };
  }

  async uploadImage(id: number, filename: string) {
    const chiTietLoaiCongViec =
      await this.prisma.chiTietLoaiCongViec.findUnique({
        where: { id },
      });

    if (!chiTietLoaiCongViec) {
      throw new NotFoundException(`Job detail type with ID ${id} not found`);
    }

    const updated = await this.prisma.chiTietLoaiCongViec.update({
      where: { id },
      data: { hinhAnh: filename },
    });

    return {
      message: 'Image uploaded successfully',
      content: updated,
    };
  }
}

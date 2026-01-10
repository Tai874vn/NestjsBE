import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { CreateLoaiCongViecDto } from '../dto/create-loai-cong-viec.dto';
import { UpdateLoaiCongViecDto } from '../dto/update-loai-cong-viec.dto';
import { PaginationDto } from '../../common/dto/pagination.dto';

@Injectable()
export class LoaiCongViecService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateLoaiCongViecDto) {
    const loaiCongViec = await this.prisma.loaiCongViec.create({
      data: createDto,
    });

    return {
      message: 'Job type created successfully',
      content: loaiCongViec,
    };
  }

  async findAll() {
    const loaiCongViecs = await this.prisma.loaiCongViec.findMany({
      include: {
        chiTietLoaiCongViecs: true,
      },
    });

    return {
      message: 'Get job types successfully',
      content: loaiCongViecs,
    };
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10, keyword } = paginationDto;
    const skip = (page - 1) * pageSize;

    const where = keyword
      ? {
          tenLoaiCongViec: { contains: keyword, mode: 'insensitive' as const },
        }
      : {};

    const [loaiCongViecs, total] = await Promise.all([
      this.prisma.loaiCongViec.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          chiTietLoaiCongViecs: true,
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.loaiCongViec.count({ where }),
    ]);

    return {
      message: 'Get job types with pagination successfully',
      content: {
        data: loaiCongViecs,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: number) {
    const loaiCongViec = await this.prisma.loaiCongViec.findUnique({
      where: { id },
      include: {
        chiTietLoaiCongViecs: true,
      },
    });

    if (!loaiCongViec) {
      throw new NotFoundException(`Job type with ID ${id} not found`);
    }

    return {
      message: 'Get job type successfully',
      content: loaiCongViec,
    };
  }

  async update(id: number, updateDto: UpdateLoaiCongViecDto) {
    const loaiCongViec = await this.prisma.loaiCongViec.findUnique({
      where: { id },
    });

    if (!loaiCongViec) {
      throw new NotFoundException(`Job type with ID ${id} not found`);
    }

    const updated = await this.prisma.loaiCongViec.update({
      where: { id },
      data: updateDto,
      include: {
        chiTietLoaiCongViecs: true,
      },
    });

    return {
      message: 'Job type updated successfully',
      content: updated,
    };
  }

  async remove(id: number) {
    const loaiCongViec = await this.prisma.loaiCongViec.findUnique({
      where: { id },
    });

    if (!loaiCongViec) {
      throw new NotFoundException(`Job type with ID ${id} not found`);
    }

    await this.prisma.loaiCongViec.delete({
      where: { id },
    });

    return {
      message: 'Job type deleted successfully',
    };
  }
}

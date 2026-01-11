import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { CreateCongViecDto } from '../dto/create-cong-viec.dto';
import { UpdateCongViecDto } from '../dto/update-cong-viec.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';

@Injectable()
export class CongViecService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateCongViecDto) {
    const congViec = await this.prisma.congViec.create({
      data: createDto,
      include: {
        chiTietLoaiCongViec: {
          include: {
            loaiCongViec: true,
          },
        },
      },
    });

    return {
      message: 'Job created successfully',
      content: congViec,
    };
  }

  async findAll() {
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
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10, keyword } = paginationDto;
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
  }

  async findOne(id: number) {
    const congViec = await this.prisma.congViec.findUnique({
      where: { id },
      include: {
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

    return {
      message: 'Get job successfully',
      content: congViec,
    };
  }

  async update(id: number, updateDto: UpdateCongViecDto) {
    const congViec = await this.prisma.congViec.findUnique({
      where: { id },
    });

    if (!congViec) {
      throw new NotFoundException(`Job with ID ${id} not found`);
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

    return {
      message: 'Job updated successfully',
      content: updated,
    };
  }

  async remove(id: number) {
    const congViec = await this.prisma.congViec.findUnique({
      where: { id },
    });

    if (!congViec) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    await this.prisma.congViec.delete({
      where: { id },
    });

    return {
      message: 'Job deleted successfully',
    };
  }

  async uploadImage(id: number, filename: string) {
    const congViec = await this.prisma.congViec.findUnique({
      where: { id },
    });

    if (!congViec) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    const updated = await this.prisma.congViec.update({
      where: { id },
      data: { hinhAnh: filename },
    });

    return {
      message: 'Image uploaded successfully',
      content: updated,
    };
  }

  async getMenuLoaiCongViec() {
    const loaiCongViecs = await this.prisma.loaiCongViec.findMany({
      include: {
        chiTietLoaiCongViecs: true,
      },
    });

    return {
      message: 'Get menu job types successfully',
      content: loaiCongViecs,
    };
  }

  async getChiTietLoaiCongViec(maLoaiCongViec: number) {
    const chiTietLoaiCongViecs = await this.prisma.chiTietLoaiCongViec.findMany(
      {
        where: { maLoaiCongViec },
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

  async getCongViecByChiTietLoai(maChiTietLoai: number) {
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
  }

  async getCongViecChiTiet(maCongViec: number) {
    const congViec = await this.prisma.congViec.findUnique({
      where: { id: maCongViec },
      include: {
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

    return {
      message: 'Get job detail successfully',
      content: congViec,
    };
  }

  async searchByName(tenCongViec: string) {
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
  }
}

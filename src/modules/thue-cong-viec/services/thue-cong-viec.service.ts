import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { CreateThueCongViecDto } from '../dto/create-thue-cong-viec.dto';
import { UpdateThueCongViecDto } from '../dto/update-thue-cong-viec.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';

@Injectable()
export class ThueCongViecService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateThueCongViecDto) {
    const thueCongViec = await this.prisma.thueCongViec.create({
      data: createDto,
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    return {
      message: 'Job hired successfully',
      content: thueCongViec,
    };
  }

  async findAll() {
    const thueCongViecs = await this.prisma.thueCongViec.findMany({
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        ngayThue: 'desc',
      },
    });

    return {
      message: 'Get hired jobs successfully',
      content: thueCongViecs,
    };
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10 } = paginationDto;
    const skip = (page - 1) * pageSize;

    const [thueCongViecs, total] = await Promise.all([
      this.prisma.thueCongViec.findMany({
        skip,
        take: pageSize,
        include: {
          congViec: true,
          nguoiDung: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
        orderBy: {
          ngayThue: 'desc',
        },
      }),
      this.prisma.thueCongViec.count(),
    ]);

    return {
      message: 'Get hired jobs with pagination successfully',
      content: {
        data: thueCongViecs,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: number) {
    const thueCongViec = await this.prisma.thueCongViec.findUnique({
      where: { id },
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    if (!thueCongViec) {
      throw new NotFoundException(`Hired job with ID ${id} not found`);
    }

    return {
      message: 'Get hired job successfully',
      content: thueCongViec,
    };
  }

  async update(id: number, updateDto: UpdateThueCongViecDto) {
    const thueCongViec = await this.prisma.thueCongViec.findUnique({
      where: { id },
    });

    if (!thueCongViec) {
      throw new NotFoundException(`Hired job with ID ${id} not found`);
    }

    const updated = await this.prisma.thueCongViec.update({
      where: { id },
      data: updateDto,
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    return {
      message: 'Hired job updated successfully',
      content: updated,
    };
  }

  async remove(id: number) {
    const thueCongViec = await this.prisma.thueCongViec.findUnique({
      where: { id },
    });

    if (!thueCongViec) {
      throw new NotFoundException(`Hired job with ID ${id} not found`);
    }

    await this.prisma.thueCongViec.delete({
      where: { id },
    });

    return {
      message: 'Hired job deleted successfully',
    };
  }

  async findHiredJobs() {
    const thueCongViecs = await this.prisma.thueCongViec.findMany({
      where: {
        hoanThanh: false,
      },
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        ngayThue: 'desc',
      },
    });

    return {
      message: 'Get hired jobs list successfully',
      content: thueCongViecs,
    };
  }

  async completeJob(id: number) {
    const thueCongViec = await this.prisma.thueCongViec.findUnique({
      where: { id },
    });

    if (!thueCongViec) {
      throw new NotFoundException(`Hired job with ID ${id} not found`);
    }

    const updated = await this.prisma.thueCongViec.update({
      where: { id },
      data: { hoanThanh: true },
      include: {
        congViec: true,
        nguoiDung: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    return {
      message: 'Job completed successfully',
      content: updated,
    };
  }
}

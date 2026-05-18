import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CreateHireDto } from '../dto/create-hire.dto';
import { UpdateHireDto } from '../dto/update-hire.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Role } from '../../../common/constants/roles';

@Injectable()
export class HiresService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async create(createDto: CreateHireDto, userId: number) {
    const job = await this.prisma.job.findUnique({
      where: { id: createDto.jobId },
    });

    if (!job) {
      throw new NotFoundException(
        `Job with ID ${createDto.jobId} not found`,
      );
    }

    if (job.creatorId === userId) {
      throw new BadRequestException('You cannot hire your own job');
    }

    const hire = await this.prisma.hire.create({
      data: {
        jobId: createDto.jobId,
        hirerId: userId,
      },
      include: {
        job: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    await this.redisService.invalidateUserCaches(job.creatorId);

    return {
      message: 'Job hired successfully',
      content: hire,
    };
  }

  async findAll() {
    const hires = await this.prisma.hire.findMany({
      include: {
        job: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        hiredAt: 'desc',
      },
    });

    return {
      message: 'Get hired jobs successfully',
      content: hires,
    };
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10 } = paginationDto;
    const skip = (page - 1) * pageSize;

    const [hires, total] = await Promise.all([
      this.prisma.hire.findMany({
        skip,
        take: pageSize,
        include: {
          job: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
        orderBy: {
          hiredAt: 'desc',
        },
      }),
      this.prisma.hire.count(),
    ]);

    return {
      message: 'Get hired jobs with pagination successfully',
      content: {
        data: hires,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: number) {
    const hire = await this.prisma.hire.findUnique({
      where: { id },
      include: {
        job: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    if (!hire) {
      throw new NotFoundException(`Hired job with ID ${id} not found`);
    }

    return {
      message: 'Get hired job successfully',
      content: hire,
    };
  }

  async update(
    id: number,
    updateDto: UpdateHireDto,
    userId: number,
    userRole: Role,
  ) {
    const hire = await this.prisma.hire.findUnique({
      where: { id },
      include: {
        job: {
          select: {
            creatorId: true,
          },
        },
      },
    });

    if (!hire) {
      throw new NotFoundException(`Hired job with ID ${id} not found`);
    }

    if (hire.hirerId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only update your own hires');
    }

    const updated = await this.prisma.hire.update({
      where: { id },
      data: updateDto,
      include: {
        job: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    await this.redisService.invalidateUserCaches(hire.job.creatorId);

    return {
      message: 'Hired job updated successfully',
      content: updated,
    };
  }

  async remove(id: number, userId: number, userRole: Role) {
    const hire = await this.prisma.hire.findUnique({
      where: { id },
      include: {
        job: {
          select: {
            creatorId: true,
          },
        },
      },
    });

    if (!hire) {
      throw new NotFoundException(`Hired job with ID ${id} not found`);
    }

    if (hire.hirerId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only cancel your own hires');
    }

    await this.prisma.hire.delete({
      where: { id },
    });

    await this.redisService.invalidateUserCaches(hire.job.creatorId);

    return {
      message: 'Hired job deleted successfully',
    };
  }

  async findHiredJobs(userId: number) {
    const hires = await this.prisma.hire.findMany({
      where: {
        hirerId: userId,
        completed: false,
      },
      include: {
        job: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: {
        hiredAt: 'desc',
      },
    });

    return {
      message: 'Get hired jobs list successfully',
      content: hires,
    };
  }

  async completeJob(id: number, userId: number, userRole: Role) {
    const hire = await this.prisma.hire.findUnique({
      where: { id },
      include: {
        job: {
          select: {
            creatorId: true,
          },
        },
      },
    });

    if (!hire) {
      throw new NotFoundException(`Hired job with ID ${id} not found`);
    }

    if (hire.hirerId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only complete your own hires');
    }

    const updated = await this.prisma.hire.update({
      where: { id },
      data: { completed: true },
      include: {
        job: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    await this.redisService.invalidateUserCaches(hire.job.creatorId);

    return {
      message: 'Job completed successfully',
      content: updated,
    };
  }
}

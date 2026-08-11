import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { Role } from '../../../common/constants/roles';
import { CreateJobDto } from '../dto/create-job.dto';
import { UpdateJobDto } from '../dto/update-job.dto';
import { JobCacheInvalidationService } from './job-cache-invalidation.service';

@Injectable()
export class JobMutationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidation: JobCacheInvalidationService,
  ) {}

  async create(createDto: CreateJobDto, userId: number) {
    const job = await this.prisma.job.create({
      data: {
        title: createDto.title,
        price: createDto.price,
        description: createDto.description,
        shortDescription: createDto.shortDescription,
        subcategory: {
          connect: { id: createDto.subcategoryId },
        },
        user: {
          connect: { id: userId },
        },
      },
      include: {
        subcategory: {
          include: {
            category: true,
          },
        },
      },
    });

    await this.cacheInvalidation.invalidateJobMutation(userId);

    return {
      message: 'Job created successfully',
      content: job,
    };
  }

  async update(
    id: number,
    updateDto: UpdateJobDto,
    userId: number,
    userRole: Role,
  ) {
    const job = await this.ensureCanManageJob(id, userId, userRole);

    const updated = await this.prisma.job.update({
      where: { id },
      data: updateDto,
      include: {
        subcategory: {
          include: {
            category: true,
          },
        },
      },
    });

    await this.cacheInvalidation.invalidateJobMutation(job.creatorId, id);

    return {
      message: 'Job updated successfully',
      content: updated,
    };
  }

  async remove(id: number, userId: number, userRole: Role) {
    const job = await this.ensureCanManageJob(id, userId, userRole);

    await this.prisma.job.delete({
      where: { id },
    });

    await this.cacheInvalidation.invalidateJobMutation(job.creatorId, id);

    return {
      message: 'Job deleted successfully',
    };
  }

  async ensureCanManageJob(id: number, userId: number, userRole: Role) {
    const job = await this.prisma.job.findUnique({
      where: { id },
      select: { creatorId: true },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID ${id} not found`);
    }

    if (job.creatorId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only manage your own jobs');
    }

    return job;
  }

  async uploadImage(
    id: number,
    filename: string,
    userId: number,
    userRole: Role,
  ) {
    const job = await this.ensureCanManageJob(id, userId, userRole);

    const updated = await this.prisma.job.update({
      where: { id },
      data: { image: filename },
    });

    await this.cacheInvalidation.invalidateJobMutation(job.creatorId, id);

    return {
      message: 'Image uploaded successfully',
      content: updated,
    };
  }
}

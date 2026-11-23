import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { Role } from '../../../common/constants/roles';
import { CreateJobDto } from '../dto/create-job.dto';
import { UpdateJobDto } from '../dto/update-job.dto';
import { JobCacheInvalidationService } from './job-cache-invalidation.service';

/** The shares of a payment plan must add up to exactly 100 (percent). */
function checkTemplateShares(
  template: Array<{ share: number }> | null | undefined,
) {
  if (!template) return;
  const total = template.reduce((sum, item) => sum + item.share, 0);
  if (total !== 100) {
    throw new BadRequestException('Template shares must add up to 100.');
  }
}

/** The area is kept only for ONSITE or BOTH work; REMOTE stores null. */
function resolveArea(
  workMode: string,
  area: string | null | undefined,
): string | null {
  return workMode === 'REMOTE' ? null : (area ?? null);
}

@Injectable()
export class JobMutationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidation: JobCacheInvalidationService,
  ) {}

  async create(createDto: CreateJobDto, userId: number) {
    checkTemplateShares(createDto.milestoneTemplate);
    const workMode = createDto.workMode ?? 'REMOTE';
    const job = await this.prisma.job.create({
      data: {
        title: createDto.title,
        price: createDto.price ?? 0,
        description: createDto.description,
        shortDescription: createDto.shortDescription,
        workMode,
        serviceArea: resolveArea(workMode, createDto.serviceArea),
        milestoneTemplate: createDto.milestoneTemplate
          ? (createDto.milestoneTemplate as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
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
    checkTemplateShares(updateDto.milestoneTemplate);
    const job = await this.ensureCanManageJob(id, userId, userRole);

    const { milestoneTemplate, serviceArea, ...rest } = updateDto;
    const data: Prisma.JobUpdateInput & Record<string, unknown> = { ...rest };
    if (milestoneTemplate !== undefined) {
      data.milestoneTemplate = milestoneTemplate
        ? (milestoneTemplate as unknown as Prisma.InputJsonValue)
        : Prisma.JsonNull;
    }
    // Work out the final mode, then keep or clear the area to match it.
    const finalMode = updateDto.workMode ?? job.workMode;
    if (serviceArea !== undefined || updateDto.workMode !== undefined) {
      data.serviceArea = resolveArea(
        finalMode,
        serviceArea !== undefined ? serviceArea : job.serviceArea,
      );
    }

    const updated = await this.prisma.job.update({
      where: { id },
      data,
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
      select: { creatorId: true, workMode: true, serviceArea: true },
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

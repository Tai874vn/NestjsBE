import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { Role } from '../../../common/constants/roles';
import { CreateJobDto } from '../dto/create-job.dto';
import { UpdateJobDto } from '../dto/update-job.dto';
import { JobCacheInvalidationService } from './job-cache-invalidation.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationTemplateService } from '../../notifications/services/notification-template.service';

/** Said (409) when a service with contracts is deleted. */
export const SERVICE_HAS_CONTRACTS =
  'This service has contracts, so it cannot be deleted. Contract history and paid work must stay.';

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
  private readonly logger = new Logger(JobMutationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidation: JobCacheInvalidationService,
    private readonly notifications?: NotificationsService,
    private readonly templates?: NotificationTemplateService,
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

  /**
   * Delete a service. A service that has any contract cannot be deleted (409): the contract
   * history and the paid work must stay, and held credits would be lost. OPEN proposals do not
   * block: they go away with the service, and the other person of each one is told.
   * The job row is locked (FOR UPDATE = other writers wait) so a contract cannot be made from a
   * proposal of this service while it is being deleted; the database also refuses (RESTRICT).
   */
  async remove(id: number, userId: number, userRole: Role) {
    const job = await this.ensureCanManageJob(id, userId, userRole);

    const { title, open } = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ title: string }>>`
        SELECT title FROM "jobs" WHERE id = ${id} FOR UPDATE`;
      if (!rows.length) {
        throw new NotFoundException(`Job with ID ${id} not found`);
      }
      const contracts = await tx.contract.count({ where: { jobId: id } });
      if (contracts > 0) throw new ConflictException(SERVICE_HAS_CONTRACTS);
      const open = await tx.proposal.findMany({
        where: { jobId: id, status: 'OPEN' },
        select: { id: true, clientId: true, freelancerId: true },
      });
      try {
        await tx.job.delete({ where: { id } });
      } catch (error) {
        // P2003 = a foreign key refused the delete (a contract was made in the meantime).
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2003'
        ) {
          throw new ConflictException(SERVICE_HAS_CONTRACTS);
        }
        throw error;
      }
      return { title: rows[0].title, open };
    });

    await this.cacheInvalidation.invalidateJobMutation(job.creatorId, id);
    await this.tellOpenProposals(open, userId, title);

    return {
      message: 'Job deleted successfully',
    };
  }

  /**
   * After the delete is saved: tell each other person of an OPEN proposal that it was withdrawn
   * with the service. The link goes to the proposals list (the proposal itself is gone).
   * A failed notification is only skipped; the delete already happened.
   */
  private async tellOpenProposals(
    open: Array<{ id: number; clientId: number; freelancerId: number }>,
    actorId: number,
    title: string,
  ) {
    if (!this.notifications || !this.templates) return;
    for (const p of open) {
      const sides = [
        { recipientId: p.clientId, side: 'client' as const },
        { recipientId: p.freelancerId, side: 'freelancer' as const },
      ].filter((s) => s.recipientId !== actorId);
      for (const { recipientId, side } of sides) {
        try {
          const input = this.templates.proposalUpdate({
            recipientId,
            actorId,
            actorName: 'JobAura',
            kind: 'proposal',
            step: 'proposal_withdrawn',
            title: 'Proposal withdrawn',
            body: `The service ${title} was deleted, so the open proposal for it was withdrawn.`,
            proposalId: p.id,
            recipientSide: side,
          });
          await this.notifications.create({
            ...input,
            actionUrl: `/contracts?tab=${side}`,
          });
        } catch (error) {
          // Non-fatal side effect (the service is already deleted), but log once with context.
          this.logger.error(
            `Withdrawal notification failed for proposal ${p.id} (recipient ${recipientId}): ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
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

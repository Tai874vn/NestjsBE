import { HiringPostStatus, Prisma } from '@prisma/client';
import { UpdateHiringPostDto } from '../dto/update-hiring-post.dto';
import { queuedHiringPostFields } from '../services/hiring-post-ai-queue.service';
import { HiringPostWithMeta } from './hiring-post-card';
import {
  assertClosesInFuture,
  assertSalaryRange,
  occupationChoice,
  optionalTrim,
} from './hiring-post-checks';

/**
 * Editing a hiring post (PATCH /api/hiring-posts/:id): which fields change and what the update writes.
 * Plain functions; HiringPostsService.update runs them inside its transaction.
 */

/** Validate salary range, closing date and occupation/specialty in order before writing. */
export function validateUpdateInputs(
  post: HiringPostWithMeta,
  dto: UpdateHiringPostDto,
): { code: string; specialty: string | null } | null {
  assertSalaryRange(
    dto.salaryMin ?? post.salaryMin ?? undefined,
    dto.salaryMax ?? post.salaryMax ?? undefined,
  );
  assertClosesInFuture(dto.closesAt);
  return resolveUpdatedOccupation(post, dto);
}

/**
 * Resolve the new occupation and specialty when either is sent.
 * A changed occupation drops the stored specialty unless a new one is sent, and an empty
 * specialty on an old post with no occupation changes nothing.
 */
export function resolveUpdatedOccupation(
  post: HiringPostWithMeta,
  dto: UpdateHiringPostDto,
): { code: string; specialty: string | null } | null {
  const occupationSent =
    dto.occupationCode !== undefined ||
    (dto.specialty !== undefined &&
      (post.occupationCode !== null || optionalTrim(dto.specialty) !== null));
  if (!occupationSent) return null;

  const nextCode = dto.occupationCode ?? post.occupationCode;
  const nextSpecialty =
    dto.specialty !== undefined
      ? dto.specialty
      : nextCode === post.occupationCode
        ? post.specialty
        : null;
  return occupationChoice(nextCode, nextSpecialty);
}

/** True when occupation, required years or skills changed, so the old AI level is no longer valid. */
export function didLevelInputsChange(
  post: HiringPostWithMeta,
  dto: UpdateHiringPostDto,
  occupation: { code: string; specialty: string | null } | null,
): boolean {
  if (occupation !== null && occupation.code !== post.occupationCode) {
    return true;
  }
  if (
    dto.yearsRequired !== undefined &&
    dto.yearsRequired !== post.yearsRequired
  ) {
    return true;
  }
  return (
    dto.skills !== undefined &&
    JSON.stringify(dto.skills) !== JSON.stringify(post.skills)
  );
}

/** True when title, description or requirements changed, so the AI should re-evaluate the post. */
export function didLevelTextChange(
  post: HiringPostWithMeta,
  dto: UpdateHiringPostDto,
): boolean {
  if (dto.title !== undefined && dto.title.trim() !== post.title) {
    return true;
  }
  if (
    dto.description !== undefined &&
    dto.description.trim() !== post.description
  ) {
    return true;
  }
  return (
    dto.requirements !== undefined &&
    optionalTrim(dto.requirements) !== (post.requirements ?? null)
  );
}

/** Combine all field-group patches into one Prisma update payload. */
export function buildPostUpdateData(
  dto: UpdateHiringPostDto,
  occupation: { code: string; specialty: string | null } | null,
  filled: boolean,
  clearLevel: boolean,
  requeue: boolean,
): Prisma.HiringPostUpdateInput {
  return {
    ...buildPostTextUpdateData(dto),
    ...buildSalaryUpdateData(dto),
    ...buildQualificationUpdateData(dto, occupation),
    ...buildStatusAndAiUpdateData(dto, filled, clearLevel, requeue),
  };
}

export function buildPostTextUpdateData(
  dto: UpdateHiringPostDto,
): Prisma.HiringPostUpdateInput {
  const data: Prisma.HiringPostUpdateInput = {};
  if (dto.title !== undefined) data.title = dto.title.trim();
  if (dto.description !== undefined) {
    data.description = dto.description.trim();
  }
  if (dto.requirements !== undefined) {
    data.requirements = optionalTrim(dto.requirements);
  }
  if (dto.location !== undefined) {
    data.location = optionalTrim(dto.location);
  }
  if (dto.employmentType !== undefined) {
    data.employmentType = optionalTrim(dto.employmentType);
  }
  if (dto.companyName !== undefined) {
    data.companyName = optionalTrim(dto.companyName);
  }
  return data;
}

export function buildSalaryUpdateData(
  dto: UpdateHiringPostDto,
): Prisma.HiringPostUpdateInput {
  const data: Prisma.HiringPostUpdateInput = {};
  if (dto.salaryMin !== undefined) data.salaryMin = dto.salaryMin;
  if (dto.salaryMax !== undefined) data.salaryMax = dto.salaryMax;
  if (dto.salaryCurrency !== undefined) {
    data.salaryCurrency = dto.salaryCurrency;
  }
  if (dto.salaryPeriod !== undefined) data.salaryPeriod = dto.salaryPeriod;
  return data;
}

export function buildQualificationUpdateData(
  dto: UpdateHiringPostDto,
  occupation: { code: string; specialty: string | null } | null,
): Prisma.HiringPostUpdateInput {
  const data: Prisma.HiringPostUpdateInput = {};
  if (occupation !== null) {
    data.occupationCode = occupation.code;
    data.specialty = occupation.specialty;
  }
  if (dto.yearsRequired !== undefined) {
    data.yearsRequired = dto.yearsRequired;
  }
  if (dto.skills !== undefined) data.skills = dto.skills;
  if (dto.openings !== undefined) data.openings = dto.openings;
  if (dto.closesAt !== undefined) data.closesAt = new Date(dto.closesAt);
  return data;
}

export function buildStatusAndAiUpdateData(
  dto: UpdateHiringPostDto,
  filled: boolean,
  clearLevel: boolean,
  requeue: boolean,
): Prisma.HiringPostUpdateInput {
  const data: Prisma.HiringPostUpdateInput = {};
  if (filled) {
    data.status = HiringPostStatus.CLOSED;
  } else if (dto.status !== undefined) {
    data.status = dto.status;
  }
  if (clearLevel) {
    data.predictedSeniority = null;
    data.predictedSeniorityConfidence = null;
    data.predictedSeniorityModel = null;
    data.predictedSeniorityMetadata = Prisma.DbNull;
    data.predictedSeniorityAt = null;
  }
  if (requeue) {
    Object.assign(data, queuedHiringPostFields());
  }
  return data;
}

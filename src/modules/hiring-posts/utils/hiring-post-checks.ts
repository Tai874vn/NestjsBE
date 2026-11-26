import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { HiringPostStatus, Prisma } from '@prisma/client';
import { Role } from '../../../common/constants/roles';
import { findOccupation } from '../../occupations/utils/occupation-catalogue';

/**
 * Checks on hiring post input and access. Each one throws the HTTP error the API answers with
 * (400 bad input, 403 not your post, 409 post closed); none of them reads the database.
 */

export function assertCanManage(
  ownerId: number,
  userId: number,
  userRole: Role,
) {
  if (ownerId !== userId && userRole !== Role.ADMIN) {
    throw new ForbiddenException('You can only manage your own hiring posts');
  }
}

export function assertClosesInFuture(closesAt?: string) {
  if (closesAt !== undefined && new Date(closesAt).getTime() <= Date.now()) {
    throw new BadRequestException('The closing date must be in the future');
  }
}

export function assertSalaryRange(salaryMin?: number, salaryMax?: number) {
  if (
    salaryMin !== undefined &&
    salaryMax !== undefined &&
    salaryMin > salaryMax
  ) {
    throw new BadRequestException(
      'Minimum salary cannot be greater than maximum salary',
    );
  }
}

/** A post takes applications only while it is OPEN and its closing date has not passed: else 409. */
export function assertTakesApplications(post: {
  status: HiringPostStatus;
  closesAt: Date | null;
}) {
  if (
    post.status !== HiringPostStatus.OPEN ||
    (post.closesAt !== null && post.closesAt.getTime() <= Date.now())
  ) {
    throw new ConflictException('This hiring post is closed.');
  }
}

/**
 * The occupation and specialty to store, checked against the catalogue (as resumes are): 400 for an unknown
 * occupation, or a specialty that is not listed under it.
 */
export function occupationChoice(
  code: string | null | undefined,
  specialty: string | null | undefined,
): { code: string; specialty: string | null } {
  const occupation = findOccupation(code);
  const chosenSpecialty = optionalTrim(specialty);
  if (!occupation) {
    throw new BadRequestException(
      code
        ? 'Choose the occupation from the list.'
        : 'Choose the occupation before its specialty.',
    );
  }
  if (
    chosenSpecialty !== null &&
    !occupation.specialties.includes(chosenSpecialty)
  ) {
    throw new BadRequestException(
      'Choose a specialty listed under the occupation.',
    );
  }
  return { code: occupation.code, specialty: chosenSpecialty };
}

export function optionalTrim(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

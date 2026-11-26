import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ContractStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import {
  RedisService,
  CACHE_KEYS,
  CACHE_TTL,
} from '../../redis/services/redis.service';
import {
  ReplaceProfileCertificationsDto,
  ReplaceProfileSkillsDto,
  UpdateMyProfileDto,
} from '../dto/profile.dto';
import { ProfileCompletionService } from './profile-completion.service';
import { UserLegacyProfileSyncService } from './user-legacy-profile-sync.service';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';
import { SkillService } from '../../skill/services/skill.service';
import { ResumeAiQueueService } from './resume-ai-queue.service';
import { resumeEducation } from './resume-career';

@Injectable()
export class UserProfileService {
  private readonly logger = new Logger(UserProfileService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly profileCompletionService: ProfileCompletionService,
    private readonly legacyProfileSyncService: UserLegacyProfileSyncService,
    private readonly profileNormalizer: UserProfileNormalizerService,
    private readonly skillService: SkillService,
    private readonly resumeAiQueue: ResumeAiQueueService,
  ) {}

  async getPublicProfile(id: number) {
    const cacheKey = `${CACHE_KEYS.USER}profile:${id}`;

    const cached = await this.redisService.get<{
      message: string;
      content: unknown;
    }>(cacheKey);
    if (cached) {
      return cached;
    }

    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        avatar: true,
        coverImage: true,
        headline: true,
        bio: true,
        location: true,
        website: true,
        profileCompleted: true,
        profileSkills: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
        profileCertifications: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
        resume: { select: { data: true } },
        portfolioItems: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
        skill: true,
        certification: true,
        createdAt: true,
        jobs: {
          select: {
            id: true,
            title: true,
            image: true,
            price: true,
            rating: true,
            reviews: true,
            shortDescription: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        _count: {
          select: {
            jobs: true,
            comments: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const [commentStats, completedHireCount] = await Promise.all([
      this.prisma.comment.aggregate({
        where: {
          job: {
            creatorId: id,
          },
        },
        _avg: {
          rating: true,
        },
        _count: {
          rating: true,
        },
      }),
      // Finished work: COMPLETED contracts where this user is the freelancer.
      this.prisma.contract.count({
        where: { status: ContractStatus.COMPLETED, freelancerId: id },
      }),
    ]);

    const { skill, certification, _count, resume, ...publicUser } = user;

    const result = {
      message: 'Get public profile successfully',
      content: {
        ...publicUser,
        // Only the degree and its field from the resume are public, never the CV itself.
        education: resumeEducation(resume?.data),
        profileSkills: this.profileNormalizer.withLegacyProfileSkills(
          publicUser.profileSkills,
          skill,
        ),
        profileCertifications:
          this.profileNormalizer.withLegacyProfileCertifications(
            publicUser.profileCertifications,
            certification,
          ),
        stats: {
          totalJobs: _count.jobs,
          totalComments: commentStats._count.rating,
          averageRating: commentStats._avg.rating ?? 0,
          completedHires: completedHireCount,
        },
      },
    };

    await this.redisService.set(cacheKey, result, CACHE_TTL.MEDIUM);
    return result;
  }

  async getMyProfile(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        birthDay: true,
        gender: true,
        role: true,
        skill: true,
        certification: true,
        headline: true,
        bio: true,
        location: true,
        website: true,
        avatar: true,
        coverImage: true,
        profileCompleted: true,
        candidateDiscoverable: true,
        createdAt: true,
        updatedAt: true,
        profileSkills: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
        profileCertifications: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
        resume: { select: { data: true } },
        portfolioItems: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const { skill, certification, resume, ...profile } = user;

    return {
      message: 'Get my profile successfully',
      content: {
        ...profile,
        education: resumeEducation(resume?.data),
        profileSkills: this.profileNormalizer.withLegacyProfileSkills(
          user.profileSkills,
          skill,
        ),
        profileCertifications:
          this.profileNormalizer.withLegacyProfileCertifications(
            user.profileCertifications,
            certification,
          ),
      },
    };
  }

  async updateMyProfile(userId: number, dto: UpdateMyProfileDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...dto,
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        birthDay: true,
        gender: true,
        role: true,
        headline: true,
        bio: true,
        location: true,
        website: true,
        avatar: true,
        coverImage: true,
        profileCompleted: true,
        candidateDiscoverable: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const profileCompleted =
      await this.profileCompletionService.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Profile updated successfully',
      content: {
        ...updatedUser,
        profileCompleted,
      },
    };
  }

  async getUploadReferences(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { avatar: true, coverImage: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user;
  }

  /**
   * Standard dictionary names and ids ("reactjs" -> React). Saving never depends on the AI service: when it is
   * unavailable the names are kept as chosen (the picker only offers dictionary skills) with no id yet.
   */
  private async toDictionarySkills<T extends { name: string }>(
    skills: T[],
  ): Promise<Array<T & { skillId: string | null }>> {
    try {
      const known = await this.skillService.requireKnownSkills(
        skills.map((skill) => skill.name),
      );
      return skills.map((skill, index) => ({
        ...skill,
        name: known[index].name,
        skillId: known[index].id,
      }));
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      this.logger.warn(
        `Skill dictionary unavailable; saving skills without dictionary ids: ${error.message}`,
      );
      return skills.map((skill) => ({ ...skill, skillId: null }));
    }
  }

  async replaceProfileSkills(userId: number, dto: ReplaceProfileSkillsDto) {
    const skills = dto.skills
      .flatMap((skill) =>
        this.profileNormalizer
          .parseStringArrayValue(skill.name)
          .map((name) => ({
            name,
            level: skill.level?.trim(),
            sortOrder: skill.sortOrder,
          })),
      )
      .map((skill, index) => ({
        ...skill,
        sortOrder: skill.sortOrder ?? index,
      }));

    if (skills.some((skill) => !skill.name)) {
      throw new BadRequestException('Skill name is required');
    }

    // Every skill must be in the dictionary; it is saved under its standard name ("reactjs" -> "React").
    const canonical = await this.toDictionarySkills(skills);

    const uniqueIds = new Set(
      canonical.map((skill) => skill.skillId ?? skill.name.toLowerCase()),
    );
    if (uniqueIds.size !== canonical.length) {
      throw new BadRequestException('Duplicate skills are not allowed');
    }

    await this.ensureUserExists(userId);

    await this.prisma.$transaction([
      this.prisma.userSkill.deleteMany({ where: { userId } }),
      this.prisma.userSkill.createMany({
        data: canonical.map((skill) => ({
          userId,
          ...skill,
        })),
      }),
    ]);

    // Skills feed the resume's AI level, so a saved resume is evaluated again.
    const hasResume = await this.prisma.userResume.count({ where: { userId } });
    if (hasResume) await this.resumeAiQueue.enqueue(userId);

    await this.legacyProfileSyncService.sync(userId);
    await this.profileCompletionService.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return this.getMyProfile(userId);
  }

  /**
   * The resume form edits the same skill list as the profile (`user_skills` is the only copy). Sets the list to
   * these names in this order, keeping the level of skills the user already had.
   */
  async setSkillNames(userId: number, names: string[]) {
    const existing = await this.prisma.userSkill.findMany({
      where: { userId },
      select: { name: true, level: true },
    });
    const levels = new Map(
      existing.map((skill) => [skill.name.toLowerCase(), skill.level]),
    );
    return this.replaceProfileSkills(userId, {
      skills: names.map((name, sortOrder) => ({
        name,
        level: levels.get(name.toLowerCase()) ?? undefined,
        sortOrder,
      })),
    });
  }

  async replaceProfileCertifications(
    userId: number,
    dto: ReplaceProfileCertificationsDto,
  ) {
    const certifications = dto.certifications.map((certification, index) => ({
      name: certification.name.trim(),
      issuer: certification.issuer?.trim(),
      category: certification.category ?? null,
      skills: [
        ...new Set(
          (certification.skills ?? [])
            .map((skill) => skill.trim())
            .filter(Boolean),
        ),
      ],
      issuedAt: certification.issuedAt
        ? new Date(certification.issuedAt)
        : null,
      expiresAt: certification.expiresAt
        ? new Date(certification.expiresAt)
        : null,
      credentialUrl: certification.credentialUrl?.trim(),
      credentialId: certification.credentialId?.trim(),
      sortOrder: certification.sortOrder ?? index,
    }));

    if (certifications.some((certification) => !certification.name)) {
      throw new BadRequestException('Certification name is required');
    }
    if (certifications.some((certification) => !certification.issuer)) {
      throw new BadRequestException('Add the issuing organization');
    }
    const expiresBeforeIssued = certifications.find(
      (certification) =>
        certification.issuedAt &&
        certification.expiresAt &&
        certification.expiresAt < certification.issuedAt,
    );
    if (expiresBeforeIssued) {
      throw new BadRequestException(
        `${expiresBeforeIssued.name}: the expiry date is before the issue date`,
      );
    }
    if (
      certifications.some(
        (certification) =>
          certification.issuedAt && certification.issuedAt > new Date(),
      )
    ) {
      throw new BadRequestException('The issue date cannot be in the future');
    }

    const uniqueNames = new Set(
      certifications.map((certification) => certification.name.toLowerCase()),
    );
    if (uniqueNames.size !== certifications.length) {
      throw new BadRequestException('Duplicate certifications are not allowed');
    }

    await this.ensureUserExists(userId);

    await this.prisma.$transaction([
      this.prisma.userCertification.deleteMany({ where: { userId } }),
      this.prisma.userCertification.createMany({
        data: certifications.map((certification) => ({
          userId,
          ...certification,
        })),
      }),
    ]);

    await this.legacyProfileSyncService.sync(userId);
    await this.profileCompletionService.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return this.getMyProfile(userId);
  }

  async uploadAvatar(userId: number, filename: string) {
    await this.ensureUserExists(userId);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { avatar: filename },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        birthDay: true,
        gender: true,
        role: true,
        skill: true,
        certification: true,
        headline: true,
        bio: true,
        location: true,
        website: true,
        avatar: true,
        coverImage: true,
        profileCompleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const profileCompleted =
      await this.profileCompletionService.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Avatar uploaded successfully',
      content: {
        ...updatedUser,
        profileCompleted,
      },
    };
  }

  async uploadCover(userId: number, filename: string) {
    await this.ensureUserExists(userId);

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { coverImage: filename },
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        coverImage: true,
        headline: true,
        bio: true,
        profileCompleted: true,
      },
    });

    const profileCompleted =
      await this.profileCompletionService.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Cover image uploaded successfully',
      content: {
        ...updatedUser,
        profileCompleted,
      },
    };
  }

  private async ensureUserExists(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
  }
}

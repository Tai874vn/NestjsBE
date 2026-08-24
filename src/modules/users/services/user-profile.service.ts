import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService, CACHE_KEYS, CACHE_TTL } from '../../redis/redis.service';
import {
  ReplaceProfileCertificationsDto,
  ReplaceProfileSkillsDto,
  UpdateMyProfileDto,
} from '../dto/profile.dto';
import { ProfileCompletionService } from './profile-completion.service';
import { UserLegacyProfileSyncService } from './user-legacy-profile-sync.service';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';

@Injectable()
export class UserProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly profileCompletionService: ProfileCompletionService,
    private readonly legacyProfileSyncService: UserLegacyProfileSyncService,
    private readonly profileNormalizer: UserProfileNormalizerService,
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
      this.prisma.hire.count({
        where: {
          completed: true,
          job: {
            creatorId: id,
          },
        },
      }),
    ]);

    const { skill, certification, _count, ...publicUser } = user;

    const result = {
      message: 'Get public profile successfully',
      content: {
        ...publicUser,
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
        portfolioItems: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const { skill, certification, ...profile } = user;

    return {
      message: 'Get my profile successfully',
      content: {
        ...profile,
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

    const uniqueNames = new Set(
      skills.map((skill) => skill.name.toLowerCase()),
    );
    if (uniqueNames.size !== skills.length) {
      throw new BadRequestException('Duplicate skills are not allowed');
    }

    await this.ensureUserExists(userId);

    await this.prisma.$transaction([
      this.prisma.userSkill.deleteMany({ where: { userId } }),
      this.prisma.userSkill.createMany({
        data: skills.map((skill) => ({
          userId,
          ...skill,
        })),
      }),
    ]);

    await this.legacyProfileSyncService.sync(userId);
    await this.profileCompletionService.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return this.getMyProfile(userId);
  }

  async replaceProfileCertifications(
    userId: number,
    dto: ReplaceProfileCertificationsDto,
  ) {
    const certifications = dto.certifications.map((certification, index) => ({
      name: certification.name.trim(),
      issuer: certification.issuer?.trim(),
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

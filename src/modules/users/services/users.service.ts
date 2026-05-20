import {
  Injectable,
  NotFoundException,
  ConflictException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma.service';
import { RedisService, CACHE_KEYS, CACHE_TTL } from '../../redis/redis.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import {
  ReplaceProfileCertificationsDto,
  ReplaceProfileSkillsDto,
  UpdateMyProfileDto,
  UpsertPortfolioItemDto,
} from '../dto/profile.dto';
import {
  ImportResumeDto,
  UploadedResumeFileMetadata,
} from '../dto/import-resume.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Role } from '../../../common/constants/roles';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
        role: createUserDto.role || Role.USER,
      },
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

    // Invalidate user list caches
    await this.redisService.invalidateUserCaches();

    return {
      message: 'User created successfully',
      content: user,
    };
  }

  async findAll() {
    const users = await this.prisma.user.findMany({
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
        avatar: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      message: 'Get users successfully',
      content: users,
    };
  }

  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10, keyword } = paginationDto;
    const skip = (page - 1) * pageSize;

    const where = keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: 'insensitive' as const } },
            { email: { contains: keyword, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
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
        orderBy: { id: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      message: 'Get users with pagination successfully',
      content: {
        data: users,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

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
        profileSkills: this.withLegacyProfileSkills(
          publicUser.profileSkills,
          skill,
        ),
        profileCertifications: this.withLegacyProfileCertifications(
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

  async findOne(id: number) {
    const cacheKey = `${CACHE_KEYS.USER}${id}`;

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

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const result = {
      message: 'Get user successfully',
      content: user,
    };

    await this.redisService.set(cacheKey, result, CACHE_TTL.LONG);
    return result;
  }

  async searchByName(name: string) {
    const users = await this.prisma.user.findMany({
      where: {
        name: {
          contains: name,
          mode: 'insensitive' as const,
        },
      },
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

    return {
      message: 'Search users successfully',
      content: users,
    };
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email: updateUserDto.email },
      });

      if (existingUser) {
        throw new ConflictException('Email already exists');
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: updateUserDto,
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

    // Invalidate user caches
    await this.redisService.invalidateUserCaches(id);

    return {
      message: 'User updated successfully',
      content: updatedUser,
    };
  }

  async remove(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.prisma.user.delete({
      where: { id },
    });

    // Invalidate user caches
    await this.redisService.invalidateUserCaches(id);

    return {
      message: 'User deleted successfully',
    };
  }

  async uploadAvatar(userId: number, filename: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

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

    // Invalidate user caches
    const profileCompleted = await this.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Avatar uploaded successfully',
      content: {
        ...updatedUser,
        profileCompleted,
      },
    };
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

    return {
      message: 'Get my profile successfully',
      content: {
        ...user,
        profileSkills: this.withLegacyProfileSkills(user.profileSkills, user.skill),
        profileCertifications: this.withLegacyProfileCertifications(
          user.profileCertifications,
          user.certification,
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
        createdAt: true,
        updatedAt: true,
      },
    });

    const profileCompleted = await this.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Profile updated successfully',
      content: {
        ...updatedUser,
        profileCompleted,
      },
    };
  }

  async importResume(userId: number, dto: ImportResumeDto) {
    await this.ensureUserExists(userId);

    const sourceFileName = this.trimOptional(dto.sourceFileName);
    const schemaVersion = this.trimOptional(dto.schemaVersion) ?? 'v1';

    const resume = await this.prisma.userResume.upsert({
      where: { userId },
      update: {
        data: dto.data as Prisma.InputJsonValue,
        sourceFileName,
        schemaVersion,
      },
      create: {
        userId,
        data: dto.data as Prisma.InputJsonValue,
        sourceFileName,
        schemaVersion,
      },
    });

    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Resume imported successfully',
      content: resume,
    };
  }

  async getMyResume(userId: number) {
    await this.ensureUserExists(userId);

    const resume = await this.prisma.userResume.findUnique({
      where: { userId },
    });

    if (!resume) {
      throw new NotFoundException(`Resume for user ID ${userId} not found`);
    }

    return {
      message: 'Get resume successfully',
      content: resume,
    };
  }

  async uploadResumeFile(
    userId: number,
    fileMetadata: UploadedResumeFileMetadata,
  ) {
    await this.ensureUserExists(userId);

    const sourceFileName =
      this.trimOptional(fileMetadata.originalName) ?? 'resume';

    const resume = await this.prisma.userResume.upsert({
      where: { userId },
      update: {
        sourceFileName,
        sourceFileUrl: fileMetadata.url,
        sourceFileMimeType: fileMetadata.mimeType,
        sourceFileSize: fileMetadata.size,
        sourceFilePublicId: fileMetadata.publicId,
      },
      create: {
        userId,
        data: {},
        sourceFileName,
        sourceFileUrl: fileMetadata.url,
        sourceFileMimeType: fileMetadata.mimeType,
        sourceFileSize: fileMetadata.size,
        sourceFilePublicId: fileMetadata.publicId,
        schemaVersion: 'v1',
      },
    });

    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Resume file uploaded successfully',
      content: resume,
    };
  }

  async replaceProfileSkills(userId: number, dto: ReplaceProfileSkillsDto) {
    const skills = dto.skills.map((skill, index) => ({
      name: skill.name.trim(),
      level: skill.level?.trim(),
      sortOrder: skill.sortOrder ?? index,
    }));

    if (skills.some((skill) => !skill.name)) {
      throw new BadRequestException('Skill name is required');
    }

    const uniqueNames = new Set(skills.map((skill) => skill.name.toLowerCase()));
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

    await this.updateLegacyProfileArrays(userId);
    await this.updateProfileCompletion(userId);
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
      issuedAt: certification.issuedAt ? new Date(certification.issuedAt) : null,
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

    await this.updateLegacyProfileArrays(userId);
    await this.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return this.getMyProfile(userId);
  }

  async createPortfolioItem(userId: number, dto: UpsertPortfolioItemDto) {
    await this.ensureUserExists(userId);

    const item = await this.prisma.userPortfolioItem.create({
      data: {
        userId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        image: dto.image?.trim(),
        url: dto.url?.trim(),
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Portfolio item created successfully',
      content: item,
    };
  }

  async updatePortfolioItem(
    userId: number,
    itemId: number,
    dto: UpsertPortfolioItemDto,
  ) {
    await this.ensurePortfolioOwnership(userId, itemId);

    const item = await this.prisma.userPortfolioItem.update({
      where: { id: itemId },
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim(),
        image: dto.image?.trim(),
        url: dto.url?.trim(),
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Portfolio item updated successfully',
      content: item,
    };
  }

  async deletePortfolioItem(userId: number, itemId: number) {
    await this.ensurePortfolioOwnership(userId, itemId);

    await this.prisma.userPortfolioItem.delete({
      where: { id: itemId },
    });

    await this.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Portfolio item deleted successfully',
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

    const profileCompleted = await this.updateProfileCompletion(userId);
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

  private async ensurePortfolioOwnership(userId: number, itemId: number) {
    const item = await this.prisma.userPortfolioItem.findUnique({
      where: { id: itemId },
      select: { userId: true },
    });

    if (!item) {
      throw new NotFoundException(`Portfolio item with ID ${itemId} not found`);
    }

    if (item.userId !== userId) {
      throw new ForbiddenException('You can only update your own portfolio');
    }
  }

  private async updateLegacyProfileArrays(userId: number) {
    const [skills, certifications] = await Promise.all([
      this.prisma.userSkill.findMany({
        where: { userId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { name: true },
      }),
      this.prisma.userCertification.findMany({
        where: { userId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { name: true },
      }),
    ]);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        skill: JSON.stringify(skills.map((skill) => skill.name)),
        certification: JSON.stringify(
          certifications.map((certification) => certification.name),
        ),
      },
    });
  }

  private async updateProfileCompletion(userId: number): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        avatar: true,
        headline: true,
        bio: true,
        profileSkills: {
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!user) {
      return false;
    }

    const profileCompleted = Boolean(
      user.name &&
        user.avatar &&
        user.headline &&
        user.bio &&
        user.profileSkills.length > 0,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { profileCompleted },
    });

    return profileCompleted;
  }

  private withLegacyProfileSkills<T extends { name: string }>(
    skills: T[],
    legacySkill?: string | null,
  ) {
    if (skills.length > 0) {
      return skills;
    }

    return this.parseLegacyStringArray(legacySkill).map((name, index) => ({
      id: 0 - index,
      name,
      level: null,
      sortOrder: index,
      createdAt: null,
      updatedAt: null,
    }));
  }

  private withLegacyProfileCertifications<T extends { name: string }>(
    certifications: T[],
    legacyCertification?: string | null,
  ) {
    if (certifications.length > 0) {
      return certifications;
    }

    return this.parseLegacyStringArray(legacyCertification).map((name, index) => ({
      id: 0 - index,
      userId: null,
      name,
      issuer: null,
      issuedAt: null,
      expiresAt: null,
      credentialUrl: null,
      credentialId: null,
      sortOrder: index,
      createdAt: null,
      updatedAt: null,
    }));
  }

  private parseLegacyStringArray(value?: string | null): string[] {
    if (!value) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === 'string');
      }
    } catch {
      return [value];
    }

    return [value];
  }

  private trimOptional(value?: string | null): string | null {
    const trimmed = value?.trim();
    return trimmed || null;
  }
}

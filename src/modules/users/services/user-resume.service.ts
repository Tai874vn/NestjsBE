import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AiRecommendationClient } from '../../recommendations/services/ai-recommendation.client';
import {
  ImportResumeDto,
  UploadedResumeFileMetadata,
} from '../dto/import-resume.dto';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';

@Injectable()
export class UserResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly aiClient: AiRecommendationClient,
    private readonly profileNormalizer: UserProfileNormalizerService,
  ) {}

  async importResume(userId: number, dto: ImportResumeDto) {
    await this.ensureUserExists(userId);

    const sourceFileName = this.profileNormalizer.trimOptional(
      dto.sourceFileName,
    );
    const schemaVersion =
      this.profileNormalizer.trimOptional(dto.schemaVersion) ?? 'v1';

    const resume = await this.prisma.userResume.upsert({
      where: { userId },
      update: {
        data: dto.data as Prisma.InputJsonValue,
        sourceFileName,
        schemaVersion,
        predictedSeniority: null,
        predictedSeniorityConfidence: null,
        predictedSeniorityModel: null,
        predictedSeniorityMetadata: Prisma.DbNull,
        predictedSeniorityAt: null,
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

  async predictResumeSeniority(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        headline: true,
        skill: true,
        profileSkills: {
          select: { name: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
        resume: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const resume = user.resume;
    if (!resume) {
      throw new NotFoundException(`Resume for user ID ${userId} not found`);
    }

    const resumePayload = this.buildResumeSeniorityPayload({
      ...user,
      resume,
    });
    if (!Object.values(resumePayload).some((value) => this.hasValue(value))) {
      throw new BadRequestException(
        'Save resume fields before requesting AI seniority prediction',
      );
    }

    const prediction = await this.aiClient.predictResumeSeniority({
      resume: resumePayload,
    });
    const predictedAt = new Date();

    const updatedResume = await this.prisma.userResume.update({
      where: { userId },
      data: {
        predictedSeniority: prediction.label,
        predictedSeniorityConfidence: prediction.confidence,
        predictedSeniorityModel: prediction.model,
        predictedSeniorityMetadata: {
          probabilities: prediction.probabilities,
          features: prediction.features,
          elapsedMs: prediction.elapsed_ms,
        } as Prisma.InputJsonValue,
        predictedSeniorityAt: predictedAt,
      },
    });

    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Resume seniority predicted successfully',
      content: updatedResume,
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
      this.profileNormalizer.trimOptional(fileMetadata.originalName) ??
      'resume';

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

  private async ensureUserExists(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
  }

  private buildResumeSeniorityPayload(user: {
    headline?: string | null;
    skill?: string | null;
    profileSkills?: Array<{ name: string }>;
    resume: { data: Prisma.JsonValue };
  }): Record<string, unknown> {
    const data = this.asRecord(user.resume.data);
    const skills = this.mergeSkills(
      user.profileSkills?.map((skill) => skill.name) ?? [],
      this.profileNormalizer.parseStringArrayValue(user.skill),
      this.stringList(data.Skills),
      this.stringList(data.skills),
    );

    return this.compactRecord({
      role: this.firstText(
        data.role,
        data.Role,
        data.title,
        data.Title,
        data.jobTitle,
        data.JobTitle,
        data.Category,
        data.category,
        user.headline,
      ),
      years_experience: this.firstText(
        data.years_experience,
        data.yearsExperience,
        data.YearsExperience,
        data.YearsOfExperience,
      ),
      industry: this.firstText(data.industry, data.Industry),
      education: this.firstText(data.education, data.Education),
      skills,
    });
  }

  private asRecord(value: Prisma.JsonValue): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private compactRecord(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(record).filter(([, value]) => this.hasValue(value)),
    );
  }

  private firstText(...values: unknown[]): string | null {
    for (const value of values) {
      if (typeof value === 'string' && value.trim()) {
        return value.trim();
      }
      if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
      }
    }
    return null;
  }

  private stringList(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.stringList(item));
    }
    if (typeof value !== 'string') {
      return [];
    }
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private mergeSkills(...skillGroups: string[][]): string[] {
    const seen = new Set<string>();
    return skillGroups.flat().flatMap((skill) => {
      const trimmed = skill.trim();
      const key = trimmed.toLowerCase();
      if (!trimmed || seen.has(key)) {
        return [];
      }
      seen.add(key);
      return [trimmed];
    });
  }

  private hasValue(value: unknown): boolean {
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return typeof value === 'string' ? value.trim().length > 0 : value != null;
  }
}

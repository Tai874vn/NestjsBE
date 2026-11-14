import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  ImportResumeDto,
  UploadedResumeFileMetadata,
} from '../dto/import-resume.dto';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';
import { isCareerField } from '../../../common/career-fields';
import {
  cleanResumeJobs,
  resumeCareerProblems,
  yearsInField,
} from './resume-career';
import { asRecord, mergeSkills, stringList } from './resume-ai-payload';
import {
  RESUME_AI_STATUS,
  ResumeAiQueueService,
} from './resume-ai-queue.service';

const ISCED_DETAILED_CODE = /^\d{4}$/;

@Injectable()
export class UserResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly profileNormalizer: UserProfileNormalizerService,
    private readonly aiQueue: ResumeAiQueueService,
  ) {}

  async importResume(userId: number, dto: ImportResumeDto) {
    await this.ensureUserExists(userId);

    const sourceFileName = this.profileNormalizer.trimOptional(
      dto.sourceFileName,
    );
    const schemaVersion =
      this.profileNormalizer.trimOptional(dto.schemaVersion) ?? 'v1';
    const data = this.normalizeResumeData(dto.data);
    // Saving never waits for the AI service: the resume is queued and a worker evaluates it.
    const queued = {
      aiStatus: RESUME_AI_STATUS.QUEUED,
      aiStatusMessage: null,
      aiQueuedAt: new Date(),
      aiClaimedAt: null,
      aiAttempts: 0,
      aiInsights: Prisma.DbNull,
    };

    const resume = await this.prisma.userResume.upsert({
      where: { userId },
      update: {
        data: data as Prisma.InputJsonValue,
        sourceFileName,
        schemaVersion,
        predictedSeniority: null,
        predictedSeniorityConfidence: null,
        predictedSeniorityModel: null,
        predictedSeniorityMetadata: Prisma.DbNull,
        predictedSeniorityAt: null,
        ...queued,
      },
      create: {
        userId,
        data: data as Prisma.InputJsonValue,
        sourceFileName,
        schemaVersion,
        ...queued,
      },
    });

    await this.redisService.invalidateUserCaches(userId);
    this.aiQueue.kick();

    return {
      message: 'Resume imported successfully',
      content: resume,
    };
  }

  /**
   * Ask for AI evaluation again (the "Predict" and "Try again" buttons). Checks what the preview needs without
   * calling the AI service, then queues the resume; the worker does the AI work.
   */
  async predictResumeSeniority(userId: number) {
    const resume = await this.prisma.userResume.findUnique({
      where: { userId },
      select: { data: true },
    });
    if (!resume) {
      throw new NotFoundException(`Resume for user ID ${userId} not found`);
    }
    const resumeData = asRecord(resume.data);
    if (!isCareerField(resumeData.Industry)) {
      throw new BadRequestException(
        'Choose your field in the resume before requesting AI seniority prediction',
      );
    }
    if (yearsInField(resumeData) === null) {
      throw new BadRequestException(
        'Add jobs with dates in your field, or your years of experience, before requesting AI seniority prediction',
      );
    }

    const queued = await this.aiQueue.enqueue(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Resume queued for AI evaluation',
      content: queued,
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

  async getResumeFilePublicId(userId: number) {
    await this.ensureUserExists(userId);
    const resume = await this.prisma.userResume.findUnique({
      where: { userId },
      select: { sourceFilePublicId: true },
    });

    return resume?.sourceFilePublicId ?? null;
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

  /**
   * Checks the career fields without calling the AI service. Skills are kept as written; the AI queue puts
   * them under their dictionary names later.
   */
  private normalizeResumeData(
    raw: Record<string, unknown>,
  ): Record<string, unknown> {
    const problems = resumeCareerProblems(raw);
    const fieldOfStudy = raw.FieldOfStudy;
    if (
      typeof fieldOfStudy === 'string' &&
      fieldOfStudy.trim() &&
      !ISCED_DETAILED_CODE.test(fieldOfStudy.trim())
    ) {
      problems.push('Choose your field of study from the list.');
    }
    if (problems.length) {
      throw new BadRequestException(problems.join(' '));
    }
    const data: Record<string, unknown> = { ...raw };
    if (raw.Jobs !== undefined && raw.Jobs !== null) {
      data.Jobs = cleanResumeJobs(raw.Jobs);
    }
    const names = mergeSkills(stringList(raw.Skills));
    if (names.length) {
      data.Skills = names.join(', ');
    }
    return data;
  }
}

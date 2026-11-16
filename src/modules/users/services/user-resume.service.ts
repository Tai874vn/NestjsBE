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
import {
  cleanResumeJobs,
  resumeCareerProblems,
  resumeOccupation,
  resumeOccupationYears,
  withStoredLegacy,
} from './resume-career';
import { asRecord, mergeSkills, stringList } from './resume-ai-payload';
import {
  RESUME_AI_STATUS,
  ResumeAiQueueService,
} from './resume-ai-queue.service';
import { UserProfileService } from './user-profile.service';

const ISCED_DETAILED_CODE = /^\d{4}$/;

@Injectable()
export class UserResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly profileNormalizer: UserProfileNormalizerService,
    private readonly aiQueue: ResumeAiQueueService,
    private readonly profileService: UserProfileService,
  ) {}

  async importResume(userId: number, dto: ImportResumeDto) {
    await this.ensureUserExists(userId);

    const sourceFileName = this.profileNormalizer.trimOptional(
      dto.sourceFileName,
    );
    const schemaVersion =
      this.profileNormalizer.trimOptional(dto.schemaVersion) ?? 'v1';
    const stored = await this.prisma.userResume.findUnique({
      where: { userId },
      select: { data: true },
    });
    // The old 37-field values are read-only: they come from the stored resume, not from the form.
    const data = withStoredLegacy(
      this.normalizeResumeData(dto.data),
      asRecord(stored?.data ?? null),
    );
    // Skills live in one list shared with the profile (`user_skills`), never as a copy inside the resume.
    // A form that sends Skills sets that list; one that leaves it out keeps it.
    if ('Skills' in dto.data) {
      await this.profileService.setSkillNames(
        userId,
        mergeSkills(stringList(dto.data.Skills)),
      );
    }
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
      content: await this.withSharedSkills(resume),
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
    if (resumeOccupation(resumeData) === null) {
      throw new BadRequestException(
        'Choose your occupation in the resume before requesting AI seniority prediction',
      );
    }

    const queued = await this.aiQueue.enqueue(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Resume queued for AI evaluation',
      content: await this.withSharedSkills(queued),
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
      content: await this.withSharedSkills(resume),
    };
  }

  /**
   * The resume shows the shared skill list under its old Skills key, so the form reads and writes one place.
   * `occupationYears` is read-only: the years in the main occupation and the related credit, counted from the saved
   * jobs as the AI counts them.
   */
  private async withSharedSkills<
    T extends { userId: number; data: Prisma.JsonValue },
  >(resume: T) {
    const skills = await this.prisma.userSkill.findMany({
      where: { userId: resume.userId },
      select: { name: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    const data = asRecord(resume.data);
    return {
      ...resume,
      data: {
        ...data,
        Skills: skills.map((skill) => skill.name).join(', '),
      },
      occupationYears: resumeOccupationYears(data),
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
      content: await this.withSharedSkills(resume),
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
   * Checks the career fields without calling the AI service.
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
    // Skills are stored in `user_skills` (see importResume), not in the resume.
    delete data.Skills;
    delete data.SkillIds;
    // Years come from the jobs' months (yearsInOccupation); a typed-in number is not kept.
    delete data.YearsExperience;
    // Industry and LegacyField from the form are dropped; importResume takes them from the stored resume.
    delete data.Industry;
    delete data.LegacyField;
    if (typeof data.Occupation === 'string') {
      data.Occupation = data.Occupation.trim();
    }
    if (typeof data.Specialty === 'string') {
      data.Specialty = data.Specialty.trim();
    }
    return data;
  }
}

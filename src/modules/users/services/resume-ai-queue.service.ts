import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { RedisService } from '../../redis/redis.service';
import { AiRecommendationClient } from '../../recommendations/services/ai-recommendation.client';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';
import { resumeOccupation } from './resume-career';
import {
  asRecord,
  buildResumeSeniorityPayload,
  mergeSkills,
  stringList,
} from './resume-ai-payload';

/** Where a resume is in the AI queue. Null in the database means it was never queued. */
export const RESUME_AI_STATUS = {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  DONE: 'DONE',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  NEEDS_INPUT: 'NEEDS_INPUT',
  FAILED: 'FAILED',
} as const;

/** Every predicted-seniority column, emptied. */
const CLEARED_SENIORITY = {
  predictedSeniority: null,
  predictedSeniorityConfidence: null,
  predictedSeniorityModel: null,
  predictedSeniorityMetadata: Prisma.DbNull,
  predictedSeniorityAt: null,
} satisfies Prisma.UserResumeUpdateManyMutationInput;

const BATCH_SIZE = 5;
const MAX_SUGGESTED_SKILLS = 20;
/** A resume claimed this long ago by a worker that never finished (crash, restart) is claimed again. */
const STALE_CLAIM_MINUTES = 5;
export const AI_UNAVAILABLE_MESSAGE =
  'The AI service is unavailable right now. Try again in a moment.';

interface ClaimedResume {
  id: number;
  userId: number;
  aiQueuedAt: Date;
}

/**
 * Resume AI work runs here, never while saving. Saving marks the resume QUEUED; this worker, when the AI
 * service answers its health check, resolves skills to the dictionary, suggests skills found in the CV text,
 * and predicts seniority. Rows are claimed with FOR UPDATE SKIP LOCKED, so several backend instances behind
 * a load balancer never process the same resume twice.
 */
@Injectable()
export class ResumeAiQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResumeAiQueueService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private rerun = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly aiClient: AiRecommendationClient,
    private readonly profileNormalizer: UserProfileNormalizerService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const intervalMs = Number(
      this.configService.get<string>('RESUME_AI_QUEUE_INTERVAL_MS') ?? 10000,
    );
    if (intervalMs > 0) {
      this.timer = setInterval(() => this.kick(), intervalMs);
      this.timer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Mark a resume for AI work. Called when a resume is saved and when the user asks to try again. */
  async enqueue(userId: number) {
    const resume = await this.prisma.userResume.update({
      where: { userId },
      data: {
        aiStatus: RESUME_AI_STATUS.QUEUED,
        aiStatusMessage: null,
        aiQueuedAt: new Date(),
        aiClaimedAt: null,
        aiAttempts: 0,
      },
    });
    this.kick();
    return resume;
  }

  /** Process the queue now instead of waiting for the next tick; overlapping calls collapse into one rerun. */
  kick() {
    if (this.running) {
      this.rerun = true;
      return;
    }
    void this.processQueue();
  }

  async processQueue(): Promise<void> {
    this.running = true;
    try {
      do {
        this.rerun = false;
        await this.processBatches();
      } while (this.rerun);
    } catch (error) {
      this.logger.error(
        'Resume AI queue failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }

  private async processBatches() {
    for (;;) {
      const waiting = await this.prisma.userResume.count({
        where: { aiStatus: RESUME_AI_STATUS.QUEUED },
      });
      if (waiting === 0 && !(await this.hasStaleClaims())) return;
      if (!(await this.aiClient.isAvailable())) {
        // Hand the queued work back to the user: the UI shows the message and a "Try again" button.
        await this.prisma.userResume.updateMany({
          where: { aiStatus: RESUME_AI_STATUS.QUEUED },
          data: {
            aiStatus: RESUME_AI_STATUS.AI_UNAVAILABLE,
            aiStatusMessage: AI_UNAVAILABLE_MESSAGE,
          },
        });
        return;
      }
      const claimed = await this.claim();
      if (claimed.length === 0) return;
      for (const resume of claimed) {
        await this.processOne(resume);
      }
    }
  }

  private async hasStaleClaims(): Promise<boolean> {
    const stale = await this.prisma.userResume.count({
      where: {
        aiStatus: RESUME_AI_STATUS.PROCESSING,
        aiClaimedAt: {
          lt: new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000),
        },
      },
    });
    return stale > 0;
  }

  private claim(): Promise<ClaimedResume[]> {
    return this.prisma.$queryRaw<ClaimedResume[]>`
      UPDATE "user_resumes"
      SET "aiStatus" = ${RESUME_AI_STATUS.PROCESSING}, "aiClaimedAt" = NOW(),
          "aiAttempts" = "aiAttempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "user_resumes"
        WHERE "aiStatus" = ${RESUME_AI_STATUS.QUEUED}
           OR ("aiStatus" = ${RESUME_AI_STATUS.PROCESSING}
               AND "aiClaimedAt" < NOW() - make_interval(mins => ${STALE_CLAIM_MINUTES}))
        ORDER BY "aiQueuedAt" ASC NULLS FIRST
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "userId", "aiQueuedAt"`;
  }

  private async processOne(claimed: ClaimedResume) {
    const user = await this.prisma.user.findUnique({
      where: { id: claimed.userId },
      select: {
        headline: true,
        skill: true,
        profileSkills: {
          select: { name: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
        resume: true,
      },
    });
    if (!user?.resume) return;
    const data = asRecord(user.resume.data);
    let update: Prisma.UserResumeUpdateManyMutationInput;
    try {
      update = await this.evaluate(data, {
        headline: user.headline,
        legacySkills: this.profileNormalizer.parseStringArrayValue(user.skill),
        profileSkills: user.profileSkills,
      });
    } catch (error) {
      update =
        error instanceof BadRequestException
          ? {
              aiStatus: RESUME_AI_STATUS.FAILED,
              aiStatusMessage: error.message,
            }
          : {
              aiStatus: RESUME_AI_STATUS.AI_UNAVAILABLE,
              aiStatusMessage: AI_UNAVAILABLE_MESSAGE,
            };
    }
    // Only write if the resume wasn't saved again meanwhile; a newer save has its own queue entry.
    const written = await this.prisma.userResume.updateMany({
      where: { id: claimed.id, aiQueuedAt: claimed.aiQueuedAt },
      data: { ...update, aiClaimedAt: null },
    });
    if (written.count > 0) {
      await this.redisService.invalidateUserCaches(claimed.userId);
    }
  }

  /** The AI work for one resume. Throws when the AI service fails or refuses the input. */
  private async evaluate(
    data: Record<string, unknown>,
    owner: Parameters<typeof buildResumeSeniorityPayload>[0],
  ): Promise<Prisma.UserResumeUpdateManyMutationInput> {
    // Skills are the shared list in `user_skills`; drop any copy an old resume still carries.
    const nextData: Record<string, unknown> = { ...data };
    delete nextData.Skills;
    delete nextData.SkillIds;
    const insights: Record<string, unknown> = {};
    const names = mergeSkills(
      owner.profileSkills?.map((skill) => skill.name) ?? [],
    );

    // 1. Skills not in the dictionary are reported so the user can choose them from the list.
    if (names.length) {
      const resolved = await this.aiClient.resolveSkills(names);
      insights.unrecognisedSkills = names.filter(
        (_, index) => !resolved[index],
      );
    }

    // 2. Skills named in the CV text that the user hasn't chosen yet, offered as suggestions.
    const text = typeof data.Text === 'string' ? data.Text : '';
    if (text.trim()) {
      const chosen = new Set(names.map((name) => name.toLowerCase()));
      insights.suggestedSkills = (await this.aiClient.extractSkills(text))
        .filter((skill) => !chosen.has(skill.name.toLowerCase()))
        .slice(0, MAX_SUGGESTED_SKILLS);
    }

    // 3. Seniority, only when the occupation is chosen; years in it are counted from the jobs (0 without any).
    const base: Prisma.UserResumeUpdateManyMutationInput = {
      data: nextData as Prisma.InputJsonValue,
      aiInsights: insights as Prisma.InputJsonValue,
    };
    if (resumeOccupation(nextData) === null) {
      return {
        ...base,
        aiStatus: RESUME_AI_STATUS.NEEDS_INPUT,
        aiStatusMessage:
          'Choose your occupation to get a seniority preview; your years are counted from the jobs you add in it.',
        // A level from before (the old 37 fields) never shows next to "choose your occupation".
        ...CLEARED_SENIORITY,
      };
    }
    const prediction = await this.aiClient.predictResumeSeniority({
      resume: buildResumeSeniorityPayload(owner, nextData),
    });
    return {
      ...base,
      aiStatus: RESUME_AI_STATUS.DONE,
      aiStatusMessage: null,
      predictedSeniority: prediction.label,
      predictedSeniorityConfidence: prediction.confidence,
      predictedSeniorityModel: prediction.model,
      predictedSeniorityMetadata: {
        probabilities: prediction.probabilities,
        features: prediction.features,
        elapsedMs: prediction.elapsed_ms,
      } as Prisma.InputJsonValue,
      predictedSeniorityAt: new Date(),
    };
  }
}

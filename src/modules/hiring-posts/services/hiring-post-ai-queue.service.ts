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
import { AiRecommendationClient } from '../../recommendations/services/ai-recommendation.client';
import { RecommendationPayloadMapperService } from '../../recommendations/services/recommendation-payload-mapper.service';

/** Where a hiring post is in the AI queue. Null in the database means it was never queued. */
export const HIRING_POST_AI_STATUS = {
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  DONE: 'DONE',
  AI_UNAVAILABLE: 'AI_UNAVAILABLE',
  NEEDS_INPUT: 'NEEDS_INPUT',
  FAILED: 'FAILED',
} as const;

const BATCH_SIZE = 5;
/** A post claimed this long ago by a worker that never finished (crash, restart) is claimed again. */
const STALE_CLAIM_MINUTES = 5;
export const HIRING_POST_AI_UNAVAILABLE_MESSAGE =
  'The AI service is unavailable right now. Try again in a moment.';
/** The AI's answer (MissingInput in AIService app/seniority/job.py) for a post with no occupation it can use. */
export const HIRING_POST_NEEDS_INPUT_MESSAGE =
  'Choose the occupation for this post.';
/** Inputs the recruiter can add, as job.py names them: these answers mean NEEDS_INPUT, not FAILED. */
const NEEDS_INPUT_ANSWERS: readonly string[] = [
  HIRING_POST_NEEDS_INPUT_MESSAGE,
  'Add the required years of experience to the post, for example "at least 3 years".',
];

const CLEARED_SENIORITY = {
  predictedSeniority: null,
  predictedSeniorityConfidence: null,
  predictedSeniorityModel: null,
  predictedSeniorityMetadata: Prisma.DbNull,
  predictedSeniorityAt: null,
} satisfies Prisma.HiringPostUpdateManyMutationInput;

/** Queue fields that put a post (back) in the queue; spread into a create or update. */
export function queuedHiringPostFields(now = new Date()) {
  return {
    aiStatus: HIRING_POST_AI_STATUS.QUEUED,
    aiStatusMessage: null,
    aiQueuedAt: now,
    aiClaimedAt: null,
    aiAttempts: 0,
  };
}

interface ClaimedPost {
  id: number;
  aiQueuedAt: Date;
}

/**
 * The AI level (Junior, Mid, Senior) of a hiring post is worked out here, never while saving the post. Saving
 * marks the post QUEUED; this worker, when the AI service answers its health check, predicts the level from the
 * occupation, required years, skills and text. Rows are claimed with FOR UPDATE SKIP LOCKED, so several backend
 * instances behind a load balancer never process the same post twice. Mirrors the resume AI queue.
 *
 * In simple words: when a recruiter saves a post, we answer at once and put the post in a waiting line
 * (aiStatus = QUEUED). This background worker, every 10 seconds or right after a save, takes up to 5 posts,
 * asks the AI service "what level does this post ask for?" and saves the answer (DONE), or a message the
 * recruiter can act on (AI_UNAVAILABLE / NEEDS_INPUT / FAILED). The full explanation of the queue, the
 * statuses and SKIP LOCKED is in users/services/resume-ai-queue.service.ts, which works the same way.
 */
@Injectable()
export class HiringPostAiQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HiringPostAiQueueService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private rerun = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiRecommendationClient,
    private readonly payloadMapper: RecommendationPayloadMapperService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const intervalMs = Number(
      this.configService.get<string>('HIRING_POST_AI_QUEUE_INTERVAL_MS') ??
        10000,
    );
    if (intervalMs > 0) {
      this.timer = setInterval(() => this.kick(), intervalMs);
      this.timer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Put a post in the queue (the recruiter asked to try again) and start processing. */
  async enqueue(postId: number) {
    await this.prisma.hiringPost.update({
      where: { id: postId },
      data: queuedHiringPostFields(),
    });
    this.kick();
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
        'Hiring post AI queue failed',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.running = false;
    }
  }

  private async processBatches() {
    for (;;) {
      const waiting = await this.prisma.hiringPost.count({
        where: { aiStatus: HIRING_POST_AI_STATUS.QUEUED },
      });
      if (waiting === 0 && !(await this.hasStaleClaims())) return;
      if (!(await this.aiClient.isAvailable())) {
        // Hand the queued work back to the recruiter: the UI shows the message and a "Try again" button.
        await this.prisma.hiringPost.updateMany({
          where: { aiStatus: HIRING_POST_AI_STATUS.QUEUED },
          data: {
            aiStatus: HIRING_POST_AI_STATUS.AI_UNAVAILABLE,
            aiStatusMessage: HIRING_POST_AI_UNAVAILABLE_MESSAGE,
          },
        });
        return;
      }
      const claimed = await this.claim();
      if (claimed.length === 0) return;
      for (const post of claimed) {
        await this.processOne(post);
      }
    }
  }

  private async hasStaleClaims(): Promise<boolean> {
    const stale = await this.prisma.hiringPost.count({
      where: {
        aiStatus: HIRING_POST_AI_STATUS.PROCESSING,
        aiClaimedAt: {
          lt: new Date(Date.now() - STALE_CLAIM_MINUTES * 60_000),
        },
      },
    });
    return stale > 0;
  }

  private claim(): Promise<ClaimedPost[]> {
    return this.prisma.$queryRaw<ClaimedPost[]>`
      UPDATE "hiring_posts"
      SET "aiStatus" = ${HIRING_POST_AI_STATUS.PROCESSING}, "aiClaimedAt" = NOW(),
          "aiAttempts" = "aiAttempts" + 1
      WHERE "id" IN (
        SELECT "id" FROM "hiring_posts"
        WHERE "aiStatus" = ${HIRING_POST_AI_STATUS.QUEUED}
           OR ("aiStatus" = ${HIRING_POST_AI_STATUS.PROCESSING}
               AND "aiClaimedAt" < NOW() - make_interval(mins => ${STALE_CLAIM_MINUTES}))
        ORDER BY "aiQueuedAt" ASC NULLS FIRST
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "aiQueuedAt"`;
  }

  private async processOne(claimed: ClaimedPost) {
    const post = await this.prisma.hiringPost.findUnique({
      where: { id: claimed.id },
    });
    if (!post) return;
    let update: Prisma.HiringPostUpdateManyMutationInput;
    try {
      update = await this.evaluate(post);
    } catch (error) {
      if (!(error instanceof BadRequestException)) {
        update = {
          aiStatus: HIRING_POST_AI_STATUS.AI_UNAVAILABLE,
          aiStatusMessage: HIRING_POST_AI_UNAVAILABLE_MESSAGE,
        };
      } else if (NEEDS_INPUT_ANSWERS.includes(error.message)) {
        // No level beside "choose the occupation": an old level would describe the post's old inputs.
        update = {
          aiStatus: HIRING_POST_AI_STATUS.NEEDS_INPUT,
          aiStatusMessage: error.message,
          ...CLEARED_SENIORITY,
        };
      } else {
        update = {
          aiStatus: HIRING_POST_AI_STATUS.FAILED,
          aiStatusMessage: error.message,
        };
      }
    }
    // Only write if the post wasn't saved again meanwhile; a newer save has its own queue entry.
    await this.prisma.hiringPost.updateMany({
      where: { id: claimed.id, aiQueuedAt: claimed.aiQueuedAt },
      data: { ...update, aiClaimedAt: null },
    });
  }

  /**
   * The AI level for one post. Throws when the AI service fails or refuses the input. A post without an
   * occupation is still sent: as job.py does, the AI then matches the job title exactly against ESCO titles and
   * answers "Choose the occupation for this post." when none matches.
   */
  private async evaluate(
    post: Parameters<
      RecommendationPayloadMapperService['buildHiringPostPayload']
    >[0],
  ): Promise<Prisma.HiringPostUpdateManyMutationInput> {
    const prediction = await this.aiClient.predictJobSeniority({
      job: this.payloadMapper.buildHiringPostPayload(post),
    });
    return {
      aiStatus: HIRING_POST_AI_STATUS.DONE,
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

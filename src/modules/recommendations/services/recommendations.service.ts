import {
  ConflictException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Role } from '../../../common/constants/roles';
import { ObservabilityService } from '../../../common/observability/observability.service';
import { RecommendationQueryDto } from '../dto/recommendation-query.dto';
import {
  AiMatchItem,
  AiRecommendationClient,
} from './ai-recommendation.client';
import { RecommendationDataLoaderService } from './recommendation-data-loader.service';
import {
  CachedRecommendationResult,
  RecommendationCacheService,
} from './recommendation-cache.service';
import { RecommendationQuotaService } from './recommendation-quota.service';
import { findOccupation } from '../../occupations/occupation-catalogue';
import { RecommendationFingerprintService } from './recommendation-fingerprint.service';
import {
  RecommendationScore,
  RecommendationScoringService,
} from './recommendation-scoring.service';
import { RecommendationSnapshotService } from './recommendation-snapshot.service';
import {
  RecommendationPayloadMapperService,
  UserForRecommendation,
} from './recommendation-payload-mapper.service';

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly aiClient: AiRecommendationClient,
    private readonly scoringService: RecommendationScoringService,
    private readonly payloadMapper: RecommendationPayloadMapperService,
    private readonly dataLoader: RecommendationDataLoaderService,
    private readonly fingerprintService: RecommendationFingerprintService,
    private readonly quotaService: RecommendationQuotaService,
    private readonly cacheService: RecommendationCacheService,
    private readonly snapshotService: RecommendationSnapshotService,
    private readonly observability: ObservabilityService,
  ) {}

  async getQuotaForUser(userId: number, userRole?: Role | string | null) {
    return {
      message: 'Get AI recommendation quota successfully',
      content: await this.quotaService.getQuotaForUser(userId, userRole),
    };
  }

  /**
   * "Jobs for you" for a candidate. Same shape as recommendCandidatesForHiringPost below (cache → saved
   * snapshot → lock + quota → AI → save), but the AI compares the candidate's CV with open hiring posts using
   * embeddings (lists of numbers that represent the meaning of a text; similar meaning = close numbers).
   */
  async recommendJobsForUser(
    userId: number,
    query: RecommendationQueryDto,
    userRole?: Role | string | null,
  ) {
    const topK = query.topK ?? 10;
    const poolSize = query.poolSize ?? 100;
    const timer = this.observability.startOperation('recommendations.jobs', {
      userId,
      topK,
      poolSize,
      cacheOnly: query.cacheOnly === true,
      forceRefresh: query.forceRefresh === true,
    });
    let shouldRefundQuota = false;
    let runLock: { scope: string; token: string } | undefined;

    try {
      const fingerprint = await timer.time('fingerprint', () =>
        this.fingerprintService.jobs(userId),
      );
      const shouldReadSaved = query.forceRefresh !== true;
      const cached = shouldReadSaved
        ? await timer.time('cache.get', () =>
            this.cacheService.getJobs<unknown>(
              userId,
              topK,
              poolSize,
              fingerprint,
            ),
          )
        : undefined;

      if (cached) {
        const quota = await timer.time('quota.read', () =>
          this.quotaService.getQuotaForUser(userId, userRole),
        );
        timer.end({ cache: 'hit', resultCount: cached.data.length });
        return {
          message: 'Get recommended jobs successfully',
          content: {
            ...cached,
            quota,
            cache: {
              hit: true,
              ttlSeconds: this.cacheService.ttlSeconds,
              source: 'redis',
            },
          },
        };
      }

      const snapshot = shouldReadSaved
        ? await timer.time('snapshot.get', () =>
            this.snapshotService.getJobs<unknown>(
              userId,
              topK,
              poolSize,
              fingerprint,
            ),
          )
        : undefined;

      if (snapshot) {
        await timer.time('cache.set', () =>
          this.cacheService.setJobs(
            userId,
            topK,
            poolSize,
            fingerprint,
            snapshot,
          ),
        );
        const quota = await timer.time('quota.read', () =>
          this.quotaService.getQuotaForUser(userId, userRole),
        );
        timer.end({ cache: 'database', resultCount: snapshot.data.length });
        return {
          message: 'Get saved recommended jobs successfully',
          content: {
            ...snapshot,
            quota,
            cache: {
              hit: true,
              ttlSeconds: this.cacheService.ttlSeconds,
              source: 'database',
            },
          },
        };
      }

      if (query.cacheOnly === true) {
        const quota = await timer.time('quota.read', () =>
          this.quotaService.getQuotaForUser(userId, userRole),
        );
        timer.end({ cache: 'miss', cacheOnly: true, resultCount: 0 });
        return {
          message: 'No cached recommended jobs found',
          content: {
            data: [],
            model: '',
            elapsedMs: 0,
            generatedAt: null,
            quota,
            cache: { hit: false, ttlSeconds: this.cacheService.ttlSeconds },
          },
        };
      }

      timer.annotate({ cache: shouldReadSaved ? 'miss' : 'bypassed' });
      const lockScope = `jobs:${userId}`;
      const lockToken = await this.cacheService.acquireRunLock(lockScope);
      if (!lockToken) {
        throw new ConflictException(
          'A job recommendation request is already running',
        );
      }
      runLock = { scope: lockScope, token: lockToken };
      const reservedQuota = await timer.time('quota.reserve', () =>
        this.quotaService.reserve(userId, userRole),
      );
      shouldRefundQuota = true;
      const user = await timer.time('db.user', () =>
        this.dataLoader.loadUser(userId),
      );
      // A candidate's matches are open hiring posts, not other candidates' service posts.
      const posts = await timer.time('db.hiringPosts', () =>
        this.dataLoader.loadOpenHiringPosts(userId, poolSize),
      );
      const resumePayload = this.payloadMapper.buildResumePayload(user);
      const knownSkills = resumePayload.skills as string[];
      const jobPayloads = posts.map((post) =>
        this.payloadMapper.buildHiringPostPayload(post, knownSkills),
      );

      const aiResponse = await timer.time('aiService', () =>
        this.callAi(() =>
          this.aiClient.matchJobs({
            resume: resumePayload,
            jobs: jobPayloads,
            top_k: topK,
          }),
        ),
      );

      const postsById = new Map(posts.map((post) => [String(post.id), post]));
      const matches = aiResponse.matches
        .map((match) => {
          const post = postsById.get(String(match.id));
          if (!post) {
            return null;
          }
          const occupationTitle =
            findOccupation(post.occupationCode)?.title ?? null;
          const score = this.scoringService.scoreJobMatch({
            aiScore: match.score,
            resumeSkills: knownSkills,
            resumeText: this.payloadText(resumePayload),
            jobText: this.payloadMapper.hiringPostToText(post),
            jobCategoryText: occupationTitle ?? '',
          });
          const { _count, ...card } = post;
          return {
            ...card,
            // The same catalogue title hiring-post cards carry, so a recommended job names its occupation.
            occupationTitle,
            applicationCount: _count.applications,
            recommendation: this.toRecommendationPayload(match, score),
          };
        })
        .filter((match): match is NonNullable<typeof match> => Boolean(match));

      const result: CachedRecommendationResult<(typeof matches)[number]> = {
        data: matches,
        model: aiResponse.model,
        elapsedMs: aiResponse.elapsed_ms,
        generatedAt: new Date().toISOString(),
      };
      const quota = matches.length
        ? reservedQuota
        : await timer.time('quota.refund', () =>
            this.quotaService.refund(userId, userRole),
          );
      if (!matches.length) {
        shouldRefundQuota = false;
      }

      await timer.time('snapshot.save', () =>
        this.snapshotService.saveJobs(
          userId,
          topK,
          poolSize,
          fingerprint,
          result,
        ),
      );
      await timer.time('cache.set', () =>
        this.cacheService.setJobs(userId, topK, poolSize, fingerprint, result),
      );
      shouldRefundQuota = false;
      timer.end({
        resultCount: matches.length,
        aiElapsedMs: aiResponse.elapsed_ms,
      });

      return {
        message: 'Get recommended jobs successfully',
        content: {
          ...result,
          quota,
          cache: { hit: false, ttlSeconds: this.cacheService.ttlSeconds },
        },
      };
    } catch (error) {
      if (shouldRefundQuota) {
        await this.refundQuotaAfterFailure(userId, userRole);
      }
      timer.fail(error);
      throw error;
    } finally {
      if (runLock) {
        await this.releaseRunLock(runLock);
      }
    }
  }

  /**
   * "AI SUGGESTED CANDIDATES" FOR ONE HIRING POST — the matching flow.
   *
   *  1. Only the recruiter who owns the post (or an admin) may ask.
   *  2. Fingerprint = a short code built from the post id and when it was last edited. If the post did not
   *     change, the old result is still valid.
   *  3. Look for a saved result: first in Redis (fast cache, kept for a while), then in the database
   *     (snapshot). If found, return it — no AI call, no quota used.
   *  4. Otherwise take a run lock (a Redis key that says "this post is being matched right now"), so two
   *     clicks at once cannot start two AI runs, and reserve one use of the recruiter's daily quota
   *     (5 AI runs a day; 100 for admins).
   *  5. Load up to `poolSize` (default 100) candidates, turn the post and every CV into AI payloads, and ask the
   *     AI service's recruiter model to score them (POST /api/v1/recruiter/match/candidates).
   *  6. The AI returns the best `topK` (default 10) with a probability (0–1). scoringService marks each one
   *     "match" or "no_match" by comparing it with the model's threshold (the cut-off value). Save the result
   *     to the database and Redis, and return it.
   *  If anything fails, the quota is given back (refund) and the lock is always released (`finally`).
   */
  async recommendCandidatesForHiringPost(
    hiringPostId: number,
    userId: number,
    userRole: Role,
    query: RecommendationQueryDto,
  ) {
    const topK = query.topK ?? 10;
    const poolSize = query.poolSize ?? 100;

    if (userRole !== Role.EMPLOYER && userRole !== Role.ADMIN) {
      throw new ForbiddenException(
        'Only employers can view candidate recommendations',
      );
    }

    const timer = this.observability.startOperation(
      'recommendations.hiring-post-candidates',
      {
        userId,
        hiringPostId,
        topK,
        poolSize,
        cacheOnly: query.cacheOnly === true,
        forceRefresh: query.forceRefresh === true,
      },
    );
    let shouldRefundQuota = false;
    let runLock: { scope: string; token: string } | undefined;

    try {
      const hiringPost = await timer.time('db.hiringPost', () =>
        this.dataLoader.loadHiringPost(hiringPostId),
      );

      if (hiringPost.recruiterId !== userId && userRole !== Role.ADMIN) {
        throw new ForbiddenException(
          'You can only view candidate recommendations for your own hiring posts',
        );
      }

      const fingerprint = await timer.time('fingerprint', () =>
        this.fingerprintService.hiringPostCandidates(
          hiringPostId,
          hiringPost.updatedAt,
        ),
      );

      const shouldReadSaved = query.forceRefresh !== true;
      const cached = shouldReadSaved
        ? await timer.time('cache.get', () =>
            this.cacheService.getHiringPostCandidates<unknown>(
              userId,
              hiringPostId,
              topK,
              poolSize,
              fingerprint,
            ),
          )
        : undefined;

      if (cached) {
        const quota = await timer.time('quota.read', () =>
          this.quotaService.getQuotaForUser(userId, userRole),
        );
        timer.end({ cache: 'hit', resultCount: cached.data.length });
        return {
          message: 'Get recommended candidates successfully',
          content: {
            ...cached,
            quota,
            cache: {
              hit: true,
              ttlSeconds: this.cacheService.ttlSeconds,
              source: 'redis',
            },
          },
        };
      }

      const snapshot = shouldReadSaved
        ? await timer.time('snapshot.get', () =>
            this.snapshotService.getHiringPostCandidates<unknown>(
              userId,
              hiringPostId,
              topK,
              poolSize,
              fingerprint,
            ),
          )
        : undefined;

      if (snapshot) {
        await timer.time('cache.set', () =>
          this.cacheService.setHiringPostCandidates(
            userId,
            hiringPostId,
            topK,
            poolSize,
            fingerprint,
            snapshot,
          ),
        );
        const quota = await timer.time('quota.read', () =>
          this.quotaService.getQuotaForUser(userId, userRole),
        );
        timer.end({ cache: 'database', resultCount: snapshot.data.length });
        return {
          message: 'Get saved recommended candidates successfully',
          content: {
            ...snapshot,
            quota,
            cache: {
              hit: true,
              ttlSeconds: this.cacheService.ttlSeconds,
              source: 'database',
            },
          },
        };
      }

      if (query.cacheOnly === true) {
        const quota = await timer.time('quota.read', () =>
          this.quotaService.getQuotaForUser(userId, userRole),
        );
        timer.end({ cache: 'miss', cacheOnly: true, resultCount: 0 });
        return {
          message: 'No cached recommended candidates found',
          content: {
            data: [],
            model: '',
            elapsedMs: 0,
            generatedAt: null,
            quota,
            cache: { hit: false, ttlSeconds: this.cacheService.ttlSeconds },
          },
        };
      }

      timer.annotate({ cache: shouldReadSaved ? 'miss' : 'bypassed' });
      const lockScope = `hiring-post:${hiringPostId}:candidates`;
      const lockToken = await this.cacheService.acquireRunLock(lockScope);
      if (!lockToken) {
        throw new ConflictException(
          'A candidate recommendation request is already running for this hiring post',
        );
      }
      runLock = { scope: lockScope, token: lockToken };
      const reservedQuota = await timer.time('quota.reserve', () =>
        this.quotaService.reserve(userId, userRole),
      );
      shouldRefundQuota = true;
      const candidates = await timer.time('db.candidates', () =>
        this.dataLoader.loadCandidates(poolSize),
      );
      const jobPayload = this.payloadMapper.buildHiringPostPayload(hiringPost);
      const candidatePayloads = candidates.map((candidate) =>
        this.payloadMapper.buildResumePayload(candidate),
      );

      const aiResponse = await timer.time('aiService', () =>
        this.callAi(() =>
          this.aiClient.matchRecruiterCandidates({
            job: jobPayload,
            candidates: candidatePayloads,
            top_k: topK,
          }),
        ),
      );

      const candidatesById = new Map(
        candidates.map((candidate) => [String(candidate.id), candidate]),
      );
      const matches = aiResponse.matches
        .map((match) => {
          const candidate = candidatesById.get(String(match.id));
          if (!candidate) {
            return null;
          }
          const score = this.scoringService.scoreRecruiterClassifierMatch(
            match.score,
            match.metadata,
          );
          return this.safeCandidate(candidate, match, score);
        })
        .filter((match): match is NonNullable<typeof match> => Boolean(match));

      const result: CachedRecommendationResult<(typeof matches)[number]> = {
        data: matches,
        model: aiResponse.model,
        elapsedMs: aiResponse.elapsed_ms,
        generatedAt: new Date().toISOString(),
      };
      const quota = matches.length
        ? reservedQuota
        : await timer.time('quota.refund', () =>
            this.quotaService.refund(userId, userRole),
          );
      if (!matches.length) {
        shouldRefundQuota = false;
      }

      await timer.time('snapshot.save', () =>
        this.snapshotService.saveHiringPostCandidates(
          userId,
          hiringPostId,
          topK,
          poolSize,
          fingerprint,
          result,
        ),
      );
      await timer.time('cache.set', () =>
        this.cacheService.setHiringPostCandidates(
          userId,
          hiringPostId,
          topK,
          poolSize,
          fingerprint,
          result,
        ),
      );
      shouldRefundQuota = false;
      timer.end({
        resultCount: matches.length,
        aiElapsedMs: aiResponse.elapsed_ms,
      });

      return {
        message: 'Get recommended candidates successfully',
        content: {
          ...result,
          quota,
          cache: { hit: false, ttlSeconds: this.cacheService.ttlSeconds },
        },
      };
    } catch (error) {
      if (shouldRefundQuota) {
        await this.refundQuotaAfterFailure(userId, userRole);
      }
      timer.fail(error);
      throw error;
    } finally {
      if (runLock) {
        await this.releaseRunLock(runLock);
      }
    }
  }

  private safeCandidate(
    candidate: UserForRecommendation,
    match: AiMatchItem,
    score: RecommendationScore,
  ) {
    return {
      id: candidate.id,
      name: candidate.name,
      avatar: candidate.avatar,
      headline: candidate.headline,
      bio: candidate.bio,
      location: candidate.location,
      profileSkills: candidate.profileSkills ?? [],
      recommendation: this.toRecommendationPayload(match, score),
    };
  }

  private toRecommendationPayload(
    match: AiMatchItem,
    score: RecommendationScore,
  ) {
    return {
      rank: match.rank,
      aiScore: score.aiScore,
      finalScore: score.finalScore,
      label: score.label,
      isMatch: score.isMatch,
      matchLabel: score.matchLabel,
      decision: score.matchLabel,
      threshold: score.threshold,
      source: score.source,
      skillScore: score.skillScore,
      seniorityScore: score.seniorityScore,
      categoryScore: score.categoryScore,
      requiredSkills: score.requiredSkills,
      matchedSkills: score.matchedSkills,
      missingSkills: score.missingSkills,
      improvementTips: score.improvementTips,
    };
  }

  private payloadText(payload: Record<string, unknown>): string {
    return typeof payload.text === 'string' ? payload.text : '';
  }

  private async callAi<T>(callback: () => Promise<T>): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'AI recommendation service is unavailable',
      );
    }
  }

  private async refundQuotaAfterFailure(
    userId: number,
    userRole?: Role | string | null,
  ): Promise<void> {
    try {
      await this.quotaService.refund(userId, userRole);
    } catch {
      // The original request failure is more useful to callers; quota repair can be retried operationally.
    }
  }

  private async releaseRunLock(lock: {
    scope: string;
    token: string;
  }): Promise<void> {
    try {
      await this.cacheService.releaseRunLock(lock.scope, lock.token);
    } catch {
      // Lock TTL is the final safeguard if Redis becomes unavailable during cleanup.
    }
  }
}

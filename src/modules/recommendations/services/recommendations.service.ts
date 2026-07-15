import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { Role } from '../../../common/constants/roles';
import { ObservabilityService } from '../../../common/observability/observability.service';
import { RecommendationQueryDto } from '../dto/recommendation-query.dto';
import { AiMatchItem, AiRecommendationClient } from './ai-recommendation.client';
import {
  CachedRecommendationResult,
  RecommendationCacheService,
} from './recommendation-cache.service';
import { RecommendationQuotaService } from './recommendation-quota.service';
import {
  RecommendationScore,
  RecommendationScoringService,
} from './recommendation-scoring.service';
import {
  JobForRecommendation,
  RecommendationPayloadMapperService,
  UserForRecommendation,
} from './recommendation-payload-mapper.service';

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiRecommendationClient,
    private readonly scoringService: RecommendationScoringService,
    private readonly payloadMapper: RecommendationPayloadMapperService,
    private readonly quotaService: RecommendationQuotaService,
    private readonly cacheService: RecommendationCacheService,
    private readonly observability: ObservabilityService,
  ) {}

  async getQuotaForUser(userId: number) {
    return {
      message: 'Get AI recommendation quota successfully',
      content: await this.quotaService.getQuotaForUser(userId),
    };
  }

  async recommendJobsForUser(userId: number, query: RecommendationQueryDto) {
    const topK = query.topK ?? 10;
    const poolSize = query.poolSize ?? 100;
    const timer = this.observability.startOperation('recommendations.jobs', {
      userId,
      topK,
      poolSize,
    });

    try {
      const cached = await timer.time('cache.get', () =>
        this.cacheService.getJobs<unknown>(
          userId,
          topK,
          poolSize,
        ),
      );

      if (cached) {
        const quota = await timer.time('quota.read', () =>
          this.quotaService.getQuotaForUser(userId),
        );
        timer.end({ cache: 'hit', resultCount: cached.data.length });
        return {
          message: 'Get recommended jobs successfully',
          content: {
            ...cached,
            quota,
            cache: { hit: true, ttlSeconds: this.cacheService.ttlSeconds },
          },
        };
      }

      timer.annotate({ cache: 'miss' });
      await timer.time('quota.ensure', () => this.quotaService.ensureAvailable(userId));
      const user = await timer.time('db.user', () => this.loadUserForRecommendation(userId));
      const jobs = await timer.time('db.jobs', () =>
        this.loadJobsForRecommendation(userId, poolSize),
      );
      const resumePayload = this.payloadMapper.buildResumePayload(user);
      const knownSkills = resumePayload.skills as string[];
      const jobPayloads = jobs.map((job) => this.payloadMapper.buildJobPayload(job, knownSkills));

      const aiResponse = await timer.time('aiService', () =>
        this.callAi(() =>
          this.aiClient.matchJobs({
            resume: resumePayload,
            jobs: jobPayloads,
            top_k: topK,
          }),
        ),
      );

      const jobsById = new Map(jobs.map((job) => [String(job.id), job]));
      const matches = aiResponse.matches
        .map((match) => {
          const job = jobsById.get(String(match.id));
          if (!job) {
            return null;
          }
          const score = this.scoringService.scoreJobMatch({
            aiScore: match.score,
            resumeSkills: knownSkills,
            resumeText: String(resumePayload.text ?? ''),
            jobText: this.payloadMapper.jobToText(job),
            jobCategoryText: this.payloadMapper.jobCategoryText(job),
          });
          return this.withRecommendation(job, match, score);
        })
        .filter((match): match is NonNullable<typeof match> => Boolean(match));

      const result: CachedRecommendationResult<(typeof matches)[number]> = {
        data: matches,
        model: aiResponse.model,
        elapsedMs: aiResponse.elapsed_ms,
        generatedAt: new Date().toISOString(),
      };
      const quota = matches.length
        ? await timer.time('quota.consume', () => this.quotaService.consume(userId))
        : await timer.time('quota.read', () => this.quotaService.getQuotaForUser(userId));

      await timer.time('cache.set', () =>
        this.cacheService.setJobs(userId, topK, poolSize, result),
      );
      timer.end({ resultCount: matches.length, aiElapsedMs: aiResponse.elapsed_ms });

      return {
        message: 'Get recommended jobs successfully',
        content: {
          ...result,
          quota,
          cache: { hit: false, ttlSeconds: this.cacheService.ttlSeconds },
        },
      };
    } catch (error) {
      timer.fail(error);
      throw error;
    }
  }

  async recommendCandidatesForJob(
    jobId: number,
    userId: number,
    userRole: Role,
    query: RecommendationQueryDto,
  ) {
    const topK = query.topK ?? 10;
    const poolSize = query.poolSize ?? 100;

    if (userRole !== Role.EMPLOYER && userRole !== Role.ADMIN) {
      throw new ForbiddenException('Only employers can view candidate recommendations');
    }

    const timer = this.observability.startOperation('recommendations.candidates', {
      userId,
      jobId,
      topK,
      poolSize,
    });

    try {
      const job = await timer.time('db.job', () =>
        this.loadJobForCandidateRecommendation(jobId),
      );

      if (job.creatorId !== userId && userRole !== Role.ADMIN) {
        throw new ForbiddenException('You can only view candidate recommendations for your own jobs');
      }

      const cached = await timer.time('cache.get', () =>
        this.cacheService.getCandidates<unknown>(
          userId,
          jobId,
          topK,
          poolSize,
        ),
      );

      if (cached) {
        const quota = await timer.time('quota.read', () =>
          this.quotaService.getQuotaForUser(userId),
        );
        timer.end({ cache: 'hit', resultCount: cached.data.length });
        return {
          message: 'Get recommended candidates successfully',
          content: {
            ...cached,
            quota,
            cache: { hit: true, ttlSeconds: this.cacheService.ttlSeconds },
          },
        };
      }

      timer.annotate({ cache: 'miss' });
      await timer.time('quota.ensure', () => this.quotaService.ensureAvailable(userId));
      const candidates = await timer.time('db.candidates', () =>
        this.loadCandidatesForRecommendation(poolSize),
      );
      const jobPayload = this.payloadMapper.buildJobPayload(job);
      const candidatePayloads = candidates.map((candidate) => this.payloadMapper.buildResumePayload(candidate));

      const aiResponse = await timer.time('aiService', () =>
        this.callAi(() =>
          this.aiClient.matchCandidates({
            job: jobPayload,
            candidates: candidatePayloads,
            top_k: topK,
          }),
        ),
      );

      const candidatesById = new Map(candidates.map((candidate) => [String(candidate.id), candidate]));
      const jobText = this.payloadMapper.jobToText(job);
      const matches = aiResponse.matches
        .map((match) => {
          const candidate = candidatesById.get(String(match.id));
          if (!candidate) {
            return null;
          }
          const resumePayload = this.payloadMapper.buildResumePayload(candidate);
          const score = this.scoringService.scoreCandidateMatch({
            aiScore: match.score,
            resumeSkills: resumePayload.skills as string[],
            resumeText: String(resumePayload.text ?? ''),
            jobText,
            jobCategoryText: this.payloadMapper.jobCategoryText(job),
          });
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
        ? await timer.time('quota.consume', () => this.quotaService.consume(userId))
        : await timer.time('quota.read', () => this.quotaService.getQuotaForUser(userId));

      await timer.time('cache.set', () =>
        this.cacheService.setCandidates(userId, jobId, topK, poolSize, result),
      );
      timer.end({ resultCount: matches.length, aiElapsedMs: aiResponse.elapsed_ms });

      return {
        message: 'Get recommended candidates successfully',
        content: {
          ...result,
          quota,
          cache: { hit: false, ttlSeconds: this.cacheService.ttlSeconds },
        },
      };
    } catch (error) {
      timer.fail(error);
      throw error;
    }
  }

  private async loadUserForRecommendation(userId: number): Promise<UserForRecommendation> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        headline: true,
        bio: true,
        location: true,
        skill: true,
        profileSkills: {
          select: { name: true, level: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
        resume: {
          select: { data: true },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user;
  }

  private loadJobsForRecommendation(userId: number, poolSize: number): Promise<JobForRecommendation[]> {
    return this.prisma.job.findMany({
      where: { creatorId: { not: userId } },
      take: poolSize,
      orderBy: [{ rating: 'desc' }, { id: 'desc' }],
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        subcategory: { include: { category: true } },
      },
    });
  }

  private async loadJobForCandidateRecommendation(jobId: number): Promise<JobForRecommendation> {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        user: { select: { id: true, name: true, avatar: true } },
        subcategory: { include: { category: true } },
      },
    });

    if (!job) {
      throw new NotFoundException(`Job with ID ${jobId} not found`);
    }

    return job;
  }

  private loadCandidatesForRecommendation(poolSize: number): Promise<UserForRecommendation[]> {
    return this.prisma.user.findMany({
      where: {
        OR: [{ resume: { isNot: null } }, { profileSkills: { some: {} } }, { skill: { not: null } }],
      },
      take: poolSize,
      orderBy: { id: 'desc' },
      select: {
        id: true,
        name: true,
        avatar: true,
        headline: true,
        bio: true,
        location: true,
        skill: true,
        profileSkills: {
          select: { name: true, level: true },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
        resume: {
          select: { data: true },
        },
      },
    });
  }

  private withRecommendation(job: JobForRecommendation, match: AiMatchItem, score: RecommendationScore) {
    return {
      ...job,
      recommendation: {
        rank: match.rank,
        aiScore: score.aiScore,
        finalScore: score.finalScore,
        label: score.label,
        skillScore: score.skillScore,
        seniorityScore: score.seniorityScore,
        categoryScore: score.categoryScore,
      },
    };
  }

  private safeCandidate(candidate: UserForRecommendation, match: AiMatchItem, score: RecommendationScore) {
    return {
      id: candidate.id,
      name: candidate.name,
      avatar: candidate.avatar,
      headline: candidate.headline,
      bio: candidate.bio,
      location: candidate.location,
      profileSkills: candidate.profileSkills ?? [],
      recommendation: {
        rank: match.rank,
        aiScore: score.aiScore,
        finalScore: score.finalScore,
        label: score.label,
        skillScore: score.skillScore,
        seniorityScore: score.seniorityScore,
        categoryScore: score.categoryScore,
      },
    };
  }

  private async callAi<T>(callback: () => Promise<T>): Promise<T> {
    try {
      return await callback();
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException('AI recommendation service is unavailable');
    }
  }
}

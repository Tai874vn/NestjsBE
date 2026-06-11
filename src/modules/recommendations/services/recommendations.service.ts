import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { Role } from '../../../common/constants/roles';
import { RecommendationQueryDto } from '../dto/recommendation-query.dto';
import { AiMatchItem, AiRecommendationClient } from './ai-recommendation.client';
import {
  RecommendationScore,
  RecommendationScoringService,
} from './recommendation-scoring.service';

type UserForRecommendation = {
  id: number;
  name?: string | null;
  avatar?: string | null;
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  skill?: string | null;
  profileSkills?: Array<{ name: string; level?: string | null }>;
  resume?: { data: unknown } | null;
};

type JobForRecommendation = {
  id: number;
  title: string;
  price?: number;
  image?: string | null;
  description?: string | null;
  shortDescription?: string | null;
  rating?: number;
  reviews?: number;
  creatorId?: number;
  createdAt?: Date;
  updatedAt?: Date;
  subcategory?: {
    name: string;
    category?: { name: string } | null;
  } | null;
  user?: {
    id: number;
    name: string;
    avatar?: string | null;
  } | null;
};

@Injectable()
export class RecommendationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly aiClient: AiRecommendationClient,
    private readonly scoringService: RecommendationScoringService,
  ) {}

  async recommendJobsForUser(userId: number, query: RecommendationQueryDto) {
    const topK = query.topK ?? 10;
    const poolSize = query.poolSize ?? 100;
    const user = await this.loadUserForRecommendation(userId);
    const jobs = await this.loadJobsForRecommendation(userId, poolSize);
    const resumePayload = this.buildResumePayload(user);
    const knownSkills = resumePayload.skills as string[];
    const jobPayloads = jobs.map((job) => this.buildJobPayload(job, knownSkills));

    const aiResponse = await this.callAi(() =>
      this.aiClient.matchJobs({
        resume: resumePayload,
        jobs: jobPayloads,
        top_k: topK,
      }),
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
          jobText: this.jobToText(job),
          jobCategoryText: this.jobCategoryText(job),
        });
        return this.withRecommendation(job, match, score);
      })
      .filter((match): match is NonNullable<typeof match> => Boolean(match));

    return {
      message: 'Get recommended jobs successfully',
      content: {
        data: matches,
        model: aiResponse.model,
        elapsedMs: aiResponse.elapsed_ms,
      },
    };
  }

  async recommendCandidatesForJob(
    jobId: number,
    userId: number,
    userRole: Role,
    query: RecommendationQueryDto,
  ) {
    const topK = query.topK ?? 10;
    const poolSize = query.poolSize ?? 100;
    const job = await this.loadJobForCandidateRecommendation(jobId);

    if (job.creatorId !== userId && userRole !== Role.ADMIN) {
      throw new ForbiddenException('You can only view candidate recommendations for your own jobs');
    }

    const candidates = await this.loadCandidatesForRecommendation(poolSize);
    const jobPayload = this.buildJobPayload(job);
    const candidatePayloads = candidates.map((candidate) => this.buildResumePayload(candidate));

    const aiResponse = await this.callAi(() =>
      this.aiClient.matchCandidates({
        job: jobPayload,
        candidates: candidatePayloads,
        top_k: topK,
      }),
    );

    const candidatesById = new Map(candidates.map((candidate) => [String(candidate.id), candidate]));
    const jobText = this.jobToText(job);
    const matches = aiResponse.matches
      .map((match) => {
        const candidate = candidatesById.get(String(match.id));
        if (!candidate) {
          return null;
        }
        const resumePayload = this.buildResumePayload(candidate);
        const score = this.scoringService.scoreCandidateMatch({
          aiScore: match.score,
          resumeSkills: resumePayload.skills as string[],
          resumeText: String(resumePayload.text ?? ''),
          jobText,
          jobCategoryText: this.jobCategoryText(job),
        });
        return this.safeCandidate(candidate, match, score);
      })
      .filter((match): match is NonNullable<typeof match> => Boolean(match));

    return {
      message: 'Get recommended candidates successfully',
      content: {
        data: matches,
        model: aiResponse.model,
        elapsedMs: aiResponse.elapsed_ms,
      },
    };
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

  private buildResumePayload(user: UserForRecommendation): Record<string, unknown> {
    const data = this.asRecord(user.resume?.data);
    const skills = this.mergeSkills(
      user.profileSkills?.map((skill) => skill.name) ?? [],
      this.parseStringArrayValue(user.skill),
      this.parseDelimitedString(data.Skills),
    );
    const text = [
      user.headline,
      user.bio,
      user.location,
      data.Category,
      data.Summary,
      data.Skills,
      data.Experience,
      data.Education,
      data.Text,
    ]
      .filter(Boolean)
      .join('\n');

    return {
      id: user.id,
      role: user.headline ?? data.Category ?? 'Candidate',
      title: user.headline ?? data.Name ?? `Candidate #${user.id}`,
      location: user.location ?? data.Location,
      skills,
      summary: user.bio ?? data.Summary,
      experience: data.Experience,
      education: data.Education,
      text,
      data,
    };
  }

  private buildJobPayload(job: JobForRecommendation, knownSkills: string[] = []): Record<string, unknown> {
    const jobText = this.jobToText(job);
    return {
      id: job.id,
      job_title: job.title,
      title: job.title,
      description: job.description,
      short_description: job.shortDescription,
      industry: job.subcategory?.category?.name,
      required_skills: this.skillsMentionedInText(knownSkills, jobText),
      text: jobText,
      category: job.subcategory?.category?.name,
      subcategory: job.subcategory?.name,
    };
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

  private jobToText(job: JobForRecommendation): string {
    return [
      job.title,
      job.shortDescription,
      job.description,
      job.subcategory?.name,
      job.subcategory?.category?.name,
    ]
      .filter(Boolean)
      .join('\n');
  }

  private jobCategoryText(job: JobForRecommendation): string {
    return [job.subcategory?.name, job.subcategory?.category?.name].filter(Boolean).join(' ');
  }

  private skillsMentionedInText(skills: string[], text: string): string[] {
    const normalizedText = text.toLowerCase();
    return skills.filter((skill) => normalizedText.includes(skill.toLowerCase()));
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

  private parseStringArrayValue(value?: string | null): string[] {
    if (!value?.trim()) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.flatMap((item) => (typeof item === 'string' ? this.parseDelimitedString(item) : []));
      }
    } catch {
      return this.parseDelimitedString(value);
    }

    return this.parseDelimitedString(value);
  }

  private parseDelimitedString(value: unknown): string[] {
    if (typeof value !== 'string') {
      return [];
    }
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
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

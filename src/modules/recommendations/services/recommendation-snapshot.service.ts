import { Injectable } from '@nestjs/common';
import { Prisma, RecommendationSnapshotKind } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { CachedRecommendationResult } from './recommendation-cache.service';

@Injectable()
export class RecommendationSnapshotService {
  constructor(private readonly prisma: PrismaService) {}

  getJobs<T>(
    userId: number,
    topK: number,
    poolSize: number,
  ): Promise<CachedRecommendationResult<T> | undefined> {
    return this.get<T>(this.jobsScopeKey(userId, topK, poolSize));
  }

  saveJobs<T>(
    userId: number,
    topK: number,
    poolSize: number,
    value: CachedRecommendationResult<T>,
  ): Promise<void> {
    return this.save({
      scopeKey: this.jobsScopeKey(userId, topK, poolSize),
      userId,
      kind: RecommendationSnapshotKind.JOBS,
      jobId: null,
      hiringPostId: null,
      topK,
      poolSize,
      value,
    });
  }

  getCandidates<T>(
    userId: number,
    jobId: number,
    topK: number,
    poolSize: number,
  ): Promise<CachedRecommendationResult<T> | undefined> {
    return this.get<T>(this.candidatesScopeKey(userId, jobId, topK, poolSize));
  }

  saveCandidates<T>(
    userId: number,
    jobId: number,
    topK: number,
    poolSize: number,
    value: CachedRecommendationResult<T>,
  ): Promise<void> {
    return this.save({
      scopeKey: this.candidatesScopeKey(userId, jobId, topK, poolSize),
      userId,
      kind: RecommendationSnapshotKind.CANDIDATES,
      jobId,
      hiringPostId: null,
      topK,
      poolSize,
      value,
    });
  }

  getHiringPostCandidates<T>(
    userId: number,
    hiringPostId: number,
    topK: number,
    poolSize: number,
  ): Promise<CachedRecommendationResult<T> | undefined> {
    return this.get<T>(
      this.hiringPostCandidatesScopeKey(userId, hiringPostId, topK, poolSize),
    );
  }

  saveHiringPostCandidates<T>(
    userId: number,
    hiringPostId: number,
    topK: number,
    poolSize: number,
    value: CachedRecommendationResult<T>,
  ): Promise<void> {
    return this.save({
      scopeKey: this.hiringPostCandidatesScopeKey(
        userId,
        hiringPostId,
        topK,
        poolSize,
      ),
      userId,
      kind: RecommendationSnapshotKind.CANDIDATES,
      jobId: null,
      hiringPostId,
      topK,
      poolSize,
      value,
    });
  }

  private async get<T>(
    scopeKey: string,
  ): Promise<CachedRecommendationResult<T> | undefined> {
    const snapshot = await this.prisma.recommendationSnapshot.findUnique({
      where: { scopeKey },
      select: {
        data: true,
        modelName: true,
        elapsedMs: true,
        generatedAt: true,
      },
    });

    if (!snapshot) {
      return undefined;
    }

    const data = Array.isArray(snapshot.data) ? snapshot.data : [];

    return {
      data: data as T[],
      model: snapshot.modelName ?? '',
      elapsedMs: snapshot.elapsedMs ?? 0,
      generatedAt: snapshot.generatedAt.toISOString(),
    };
  }

  private async save<T>({
    scopeKey,
    userId,
    kind,
    jobId,
    hiringPostId,
    topK,
    poolSize,
    value,
  }: {
    scopeKey: string;
    userId: number;
    kind: RecommendationSnapshotKind;
    jobId: number | null;
    hiringPostId: number | null;
    topK: number;
    poolSize: number;
    value: CachedRecommendationResult<T>;
  }): Promise<void> {
    const data = this.toJson(value.data);
    const generatedAt = this.toDate(value.generatedAt);

    await this.prisma.recommendationSnapshot.upsert({
      where: { scopeKey },
      update: {
        data,
        modelName: value.model,
        elapsedMs: value.elapsedMs,
        generatedAt,
        topK,
        poolSize,
        jobId,
        hiringPostId,
      },
      create: {
        scopeKey,
        userId,
        kind,
        jobId,
        hiringPostId,
        topK,
        poolSize,
        data,
        modelName: value.model,
        elapsedMs: value.elapsedMs,
        generatedAt,
      },
    });
  }

  private jobsScopeKey(userId: number, topK: number, poolSize: number): string {
    return `jobs:${userId}:${topK}:${poolSize}`;
  }

  private candidatesScopeKey(
    userId: number,
    jobId: number,
    topK: number,
    poolSize: number,
  ): string {
    return `candidates:${userId}:${jobId}:${topK}:${poolSize}`;
  }

  private hiringPostCandidatesScopeKey(
    userId: number,
    hiringPostId: number,
    topK: number,
    poolSize: number,
  ): string {
    return `hiring-post-candidates:${userId}:${hiringPostId}:${topK}:${poolSize}`;
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private toDate(value: string): Date {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }
}

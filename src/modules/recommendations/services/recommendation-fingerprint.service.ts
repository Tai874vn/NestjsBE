import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Role } from '../../../common/constants/roles';
import { PrismaService } from '../../../prisma.service';

const POOL_BUCKET_MS = 60 * 60 * 1000; // 1-hour windows for shared pool timestamps

@Injectable()
export class RecommendationFingerprintService {
  private readonly modelVersion: string;

  constructor(
    private readonly prisma: PrismaService,
    configService: ConfigService,
  ) {
    this.modelVersion =
      configService.get<string>('AI_RECOMMENDATION_MODEL_VERSION') ?? 'current';
  }

  async jobs(userId: number): Promise<string> {
    const [user, latestSkill, latestPost] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { updatedAt: true, resume: { select: { updatedAt: true } } },
      }),
      this.prisma.userSkill.aggregate({
        where: { userId },
        _max: { updatedAt: true },
      }),
      this.prisma.hiringPost.aggregate({ _max: { updatedAt: true } }),
    ]);

    return this.hash([
      this.modelVersion,
      // Candidates are matched to hiring posts; the tag keeps older results (other candidates' services) unused.
      'hiring-posts',
      // Keep the candidate's own timestamps exact so their edits bust their own cache immediately.
      user?.updatedAt,
      user?.resume?.updatedAt,
      latestSkill._max.updatedAt,
      // Bucket the global hiring-post pool timestamp to 1-hour windows so one post edit does not bust every user's cache.
      this.bucketToHour(latestPost._max.updatedAt),
    ]);
  }

  async hiringPostCandidates(
    hiringPostId: number,
    hiringPostUpdatedAt: Date,
  ): Promise<string> {
    const [latestCandidate, latestResume, latestSkill] = await Promise.all([
      this.prisma.user.aggregate({
        where: { role: Role.USER },
        _max: { updatedAt: true },
      }),
      this.prisma.userResume.aggregate({ _max: { updatedAt: true } }),
      this.prisma.userSkill.aggregate({ _max: { updatedAt: true } }),
    ]);

    const latestPoolUpdate = this.latestDate(
      latestCandidate._max.updatedAt,
      latestResume._max.updatedAt,
      latestSkill._max.updatedAt,
    );

    return this.hash([
      this.modelVersion,
      hiringPostId,
      // Keep the target hiring post's own timestamp exact so recruiter edits invalidate immediately.
      hiringPostUpdatedAt,
      // Bucket the shared candidate pool timestamp to 1-hour windows.
      this.bucketToHour(latestPoolUpdate),
    ]);
  }

  private bucketToHour(value: Date | null | undefined): string {
    if (!value) return '';
    const bucketStart =
      Math.floor(value.getTime() / POOL_BUCKET_MS) * POOL_BUCKET_MS;
    return new Date(bucketStart).toISOString();
  }

  private latestDate(
    ...dates: Array<Date | null | undefined>
  ): Date | undefined {
    let latest: Date | undefined;
    for (const date of dates) {
      if (!date) continue;
      if (!latest || date.getTime() > latest.getTime()) {
        latest = date;
      }
    }
    return latest;
  }

  private hash(
    values: Array<Date | number | string | null | undefined>,
  ): string {
    return createHash('sha256')
      .update(
        values
          .map((value) =>
            value instanceof Date ? value.toISOString() : String(value ?? ''),
          )
          .join('|'),
      )
      .digest('hex')
      .slice(0, 24);
  }
}

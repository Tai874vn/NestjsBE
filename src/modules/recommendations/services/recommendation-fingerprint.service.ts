import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { Role } from '../../../common/constants/roles';
import { PrismaService } from '../../../prisma.service';

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
      user?.updatedAt,
      user?.resume?.updatedAt,
      latestSkill._max.updatedAt,
      latestPost._max.updatedAt,
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

    return this.hash([
      this.modelVersion,
      hiringPostId,
      hiringPostUpdatedAt,
      latestCandidate._max.updatedAt,
      latestResume._max.updatedAt,
      latestSkill._max.updatedAt,
    ]);
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

import { Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '../../../common/constants/roles';
import { PrismaService } from '../../../prisma.service';
import {
  HiringPostForRecommendation,
  JobForRecommendation,
  UserForRecommendation,
} from './recommendation-payload-mapper.service';

@Injectable()
export class RecommendationDataLoaderService {
  constructor(private readonly prisma: PrismaService) {}

  async loadUser(userId: number): Promise<UserForRecommendation> {
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
          select: {
            data: true,
            predictedSeniority: true,
            predictedSeniorityConfidence: true,
          },
        },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return user;
  }

  loadJobs(userId: number, poolSize: number): Promise<JobForRecommendation[]> {
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

  async loadHiringPost(
    hiringPostId: number,
  ): Promise<HiringPostForRecommendation> {
    const hiringPost = await this.prisma.hiringPost.findUnique({
      where: { id: hiringPostId },
    });

    if (!hiringPost) {
      throw new NotFoundException(
        `Hiring post with ID ${hiringPostId} not found`,
      );
    }

    return hiringPost;
  }

  loadCandidates(poolSize: number): Promise<UserForRecommendation[]> {
    return this.prisma.user.findMany({
      where: {
        role: Role.USER,
        OR: [
          { resume: { isNot: null } },
          { profileSkills: { some: {} } },
          { skill: { not: null } },
        ],
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
          select: {
            data: true,
            predictedSeniority: true,
            predictedSeniorityConfidence: true,
          },
        },
      },
    });
  }
}

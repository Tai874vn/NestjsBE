import { Injectable, NotFoundException } from '@nestjs/common';
import { HiringPostStatus } from '@prisma/client';
import { Role } from '../../../common/constants/roles';
import { PrismaService } from '../../../prisma.service';
import {
  HiringPostForRecommendation,
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

  /** Open hiring posts a candidate could apply to: not their own, not closed, not past the closing date. */
  loadOpenHiringPosts(userId: number, poolSize: number) {
    return this.prisma.hiringPost.findMany({
      where: {
        status: HiringPostStatus.OPEN,
        recruiterId: { not: userId },
        OR: [{ closesAt: null }, { closesAt: { gt: new Date() } }],
      },
      take: poolSize,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: {
        recruiter: {
          select: { id: true, name: true, avatar: true, headline: true },
        },
        _count: { select: { applications: true } },
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
        profileCompleted: true,
        candidateDiscoverable: true,
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

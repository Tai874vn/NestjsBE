import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role } from '../../../common/constants/roles';
import { PrismaService } from '../../../prisma.service';
import { CandidateDirectoryQueryDto } from '../dto/candidate-directory-query.dto';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';

type CandidateDirectoryUser = {
  id: number;
  name: string;
  avatar?: string | null;
  headline?: string | null;
  bio?: string | null;
  location?: string | null;
  skill?: string | null;
  updatedAt?: Date | string | null;
  profileSkills?: Array<{
    id?: number;
    name: string;
    level?: string | null;
    sortOrder?: number | null;
    createdAt?: Date | null;
    updatedAt?: Date | null;
  }>;
  _count?: {
    profileCertifications?: number;
    portfolioItems?: number;
    jobs?: number;
  };
  resume?: {
    data?: Prisma.JsonValue;
    predictedSeniority?: string | null;
    predictedSeniorityMetadata?: Prisma.JsonValue;
  } | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** What a recruiter filters by, read from the candidate's resume and its AI result. */
export function candidateCareer(resume: CandidateDirectoryUser['resume']) {
  if (!resume) return null;
  const field = record(resume.data).Industry;
  const years = record(
    record(resume.predictedSeniorityMetadata).features,
  ).years_in_field;
  return {
    careerField: typeof field === 'string' && field ? field : null,
    level: resume.predictedSeniority ?? null,
    yearsInField: typeof years === 'number' ? years : null,
  };
}

@Injectable()
export class CandidateDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profileNormalizer: UserProfileNormalizerService,
  ) {}

  async findCandidates(query: CandidateDirectoryQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 10;
    const where = this.buildCandidateDirectoryWhere(query);

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          avatar: true,
          headline: true,
          bio: true,
          location: true,
          skill: true,
          updatedAt: true,
          profileSkills: {
            select: {
              id: true,
              name: true,
              level: true,
              sortOrder: true,
              createdAt: true,
              updatedAt: true,
            },
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          },
          _count: {
            select: {
              profileCertifications: true,
              portfolioItems: true,
              jobs: true,
            },
          },
          resume: {
            select: {
              data: true,
              predictedSeniority: true,
              predictedSeniorityMetadata: true,
            },
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
      this.prisma.user.count({ where }),
    ]);

    const rankedCandidates = users
      .map((user) => this.toCandidateDirectoryCard(user, query))
      .sort((a, b) => {
        if (b.match.score !== a.match.score) {
          return b.match.score - a.match.score;
        }
        return b.id - a.id;
      });

    return {
      message: 'Get candidates successfully',
      content: {
        data: rankedCandidates,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  private buildCandidateDirectoryWhere(
    query: CandidateDirectoryQueryDto,
  ): Prisma.UserWhereInput {
    const filters: Prisma.UserWhereInput[] = [];
    const keyword = this.profileNormalizer.trimOptional(query.keyword);
    const skill = this.profileNormalizer.trimOptional(query.skill);
    const location = this.profileNormalizer.trimOptional(query.location);

    if (keyword) {
      filters.push({
        OR: [
          { name: { contains: keyword, mode: 'insensitive' } },
          { headline: { contains: keyword, mode: 'insensitive' } },
          { bio: { contains: keyword, mode: 'insensitive' } },
          { location: { contains: keyword, mode: 'insensitive' } },
          { skill: { contains: keyword, mode: 'insensitive' } },
          {
            profileSkills: {
              some: { name: { contains: keyword, mode: 'insensitive' } },
            },
          },
          {
            portfolioItems: {
              some: {
                OR: [
                  { title: { contains: keyword, mode: 'insensitive' } },
                  { description: { contains: keyword, mode: 'insensitive' } },
                ],
              },
            },
          },
        ],
      });
    }

    if (skill) {
      filters.push({
        OR: [
          { skill: { contains: skill, mode: 'insensitive' } },
          {
            profileSkills: {
              some: { name: { contains: skill, mode: 'insensitive' } },
            },
          },
        ],
      });
    }

    if (location) {
      filters.push({
        location: { contains: location, mode: 'insensitive' },
      });
    }

    if (query.hasPortfolio) {
      filters.push({ portfolioItems: { some: {} } });
    }

    if (query.hasCertification) {
      filters.push({ profileCertifications: { some: {} } });
    }

    if (query.careerField) {
      filters.push({
        resume: {
          is: { data: { path: ['Industry'], equals: query.careerField } },
        },
      });
    }

    if (query.level) {
      filters.push({ resume: { is: { predictedSeniority: query.level } } });
    }

    if (query.minYears !== undefined && query.minYears > 0) {
      filters.push({
        resume: {
          is: {
            predictedSeniorityMetadata: {
              path: ['features', 'years_in_field'],
              gte: query.minYears,
            },
          },
        },
      });
    }

    return {
      // A candidate is listed once they turn on "Visible to recruiters"; nothing else gates it.
      role: Role.USER,
      candidateDiscoverable: true,
      ...(filters.length ? { AND: filters } : {}),
    };
  }

  private toCandidateDirectoryCard(
    user: CandidateDirectoryUser,
    query: CandidateDirectoryQueryDto,
  ) {
    const profileSkills = this.profileNormalizer.withLegacyProfileSkills(
      user.profileSkills ?? [],
      user.skill,
    );
    const skills = profileSkills.map((skill) => skill.name);
    const listedServices = user._count?.jobs ?? 0;
    const match = this.scoreCandidateDirectoryCard(
      {
        name: user.name,
        headline: user.headline,
        bio: user.bio,
        location: user.location,
        skills,
        portfolioItems: user._count?.portfolioItems ?? 0,
        certifications: user._count?.profileCertifications ?? 0,
        listedServices,
      },
      query,
    );

    return {
      id: user.id,
      name: user.name,
      avatar: user.avatar ?? null,
      headline: user.headline ?? null,
      bio: user.bio ?? null,
      location: user.location ?? null,
      profileSkills,
      stats: {
        portfolioItems: user._count?.portfolioItems ?? 0,
        certifications: user._count?.profileCertifications ?? 0,
        listedServices,
        completedWork: 0,
        rating: 0,
      },
      career: candidateCareer(user.resume),
      match,
    };
  }

  private scoreCandidateDirectoryCard(
    candidate: {
      name: string;
      headline?: string | null;
      bio?: string | null;
      location?: string | null;
      skills: string[];
      portfolioItems: number;
      certifications: number;
      listedServices: number;
    },
    query: CandidateDirectoryQueryDto,
  ) {
    const keyword = this.profileNormalizer.normalizeText(query.keyword);
    const requestedSkill = this.profileNormalizer.normalizeText(query.skill);
    const requestedLocation = this.profileNormalizer.normalizeText(
      query.location,
    );
    const searchable = this.profileNormalizer.normalizeText(
      [
        candidate.name,
        candidate.headline,
        candidate.bio,
        candidate.location,
        ...candidate.skills,
      ].join(' '),
    );
    const normalizedSkills = candidate.skills.map((skill) =>
      this.profileNormalizer.normalizeText(skill),
    );
    const keywordScore = keyword && searchable.includes(keyword) ? 1 : 0;
    const skillScore =
      requestedSkill &&
      normalizedSkills.some((skill) => skill.includes(requestedSkill))
        ? 1
        : 0;
    const locationScore =
      requestedLocation &&
      this.profileNormalizer
        .normalizeText(candidate.location)
        .includes(requestedLocation)
        ? 1
        : 0;
    const qualityScore = Math.min(
      1,
      candidate.skills.length * 0.08 +
        candidate.portfolioItems * 0.12 +
        candidate.certifications * 0.08 +
        Math.min(candidate.listedServices, 10) * 0.03,
    );
    const activeFilterCount = [
      keyword,
      requestedSkill,
      requestedLocation,
    ].filter(Boolean).length;
    const score = activeFilterCount
      ? this.roundScore(
          keywordScore * 0.25 +
            skillScore * 0.35 +
            locationScore * 0.15 +
            qualityScore * 0.25,
        )
      : this.roundScore(qualityScore);

    return {
      score,
      label: this.matchLabel(score),
      keywordScore,
      skillScore,
      locationScore,
      qualityScore: this.roundScore(qualityScore),
    };
  }

  private matchLabel(score: number) {
    if (score >= 0.75) {
      return 'high_match';
    }
    if (score >= 0.55) {
      return 'medium_match';
    }
    return 'low_match';
  }

  private roundScore(value: number) {
    return Math.round(value * 100) / 100;
  }
}

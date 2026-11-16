import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role } from '../../../common/constants/roles';
import { PrismaService } from '../../../prisma.service';
import { CandidateDirectoryQueryDto } from '../dto/candidate-directory-query.dto';
import { UserProfileNormalizerService } from './user-profile-normalizer.service';
import { profileStrength } from './profile-strength';
import { findOccupation } from '../../occupations/occupation-catalogue';
import { resumeOccupation } from './resume-career';

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

/** Where the saved AI prediction keeps the years it was decided on; the minYears filter reads the same path. */
export const PREDICTED_YEARS_PATH = ['features', 'years_in_occupation'];

function savedNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * What a recruiter filters by, read from the candidate's resume and its AI result: the occupation title, the
 * specialty, years in the occupation and related years, shown separately. The years are the ones saved with the
 * prediction (features.years_in_occupation / related_years), the numbers the shown level was decided on and the
 * ones the minYears filter reads. Without a prediction (never predicted, or cleared) level and years are null.
 */
export function candidateCareer(resume: CandidateDirectoryUser['resume']) {
  if (!resume) return null;
  const data = record(resume.data);
  const code = resumeOccupation(data);
  const occupation = code ? findOccupation(code) : undefined;
  const features = record(record(resume.predictedSeniorityMetadata).features);
  const specialty =
    occupation &&
    typeof data.Specialty === 'string' &&
    occupation.specialties.includes(data.Specialty.trim())
      ? data.Specialty.trim()
      : null;
  const legacy = data.LegacyField;
  return {
    occupationCode: occupation?.code ?? null,
    occupationTitle: occupation?.title ?? null,
    specialty,
    yearsInOccupation: savedNumber(features.years_in_occupation),
    relatedYears: savedNumber(features.related_years),
    level: resume.predictedSeniority ?? null,
    legacyField: typeof legacy === 'string' && legacy ? legacy : null,
  };
}

/**
 * The main occupations a candidate filter accepts: the occupation itself and, with `includeRelated`, the
 * occupations in its related list. 400 for an unknown code, as resumes and posts reject one.
 */
export function occupationFilterCodes(
  code: string,
  includeRelated = false,
): string[] {
  const occupation = findOccupation(code);
  if (!occupation) {
    throw new BadRequestException('Choose the occupation from the list.');
  }
  return includeRelated
    ? [occupation.code, ...occupation.related.map((r) => r.code)]
    : [occupation.code];
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

    if (query.occupation) {
      const codes = occupationFilterCodes(
        query.occupation,
        query.includeRelated,
      );
      filters.push({
        resume: {
          is: {
            OR: codes.map((code) => ({
              data: { path: ['Occupation'], equals: code },
            })),
          },
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
              path: PREDICTED_YEARS_PATH,
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
    // The same Profile strength the candidate sees in Settings and on the feed.
    const strength = profileStrength({
      role: 'user',
      headline: user.headline,
      avatar: user.avatar,
      bio: user.bio,
      location: user.location,
      skills: skills.length,
      portfolio: (user._count?.portfolioItems ?? 0) + listedServices,
      resumeData: user.resume?.data,
    });
    const match = this.scoreCandidateDirectoryCard(
      {
        name: user.name,
        headline: user.headline,
        bio: user.bio,
        location: user.location,
        skills,
        strength,
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
      profileStrength: strength,
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
      /** Profile strength, 0-100. */
      strength: number;
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
    const qualityScore = candidate.strength / 100;
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

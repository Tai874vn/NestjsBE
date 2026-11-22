import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { HiringApplicationStatus, Prisma } from '@prisma/client';
import { Role } from '../../common/constants/roles';
import { PrismaService } from '../../prisma.service';
import {
  hiringPostInclude,
  pipelineCounts,
  toHiringPostCard,
} from '../hiring-posts/services/hiring-post-card';
import { candidateCareer } from '../users/services/candidate-directory.service';
import { asRecord } from '../users/services/resume-ai-payload';
import {
  cleanResumeJobs,
  relatedYears,
  resumeEducation,
  yearsInOccupation,
} from '../users/services/resume-career';

/** Who is looking: the signed-in user's id and role. */
export type Viewer = { id: number; role: Role };

const detailInclude = {
  hiringPost: { include: hiringPostInclude },
  applicant: {
    select: {
      id: true,
      name: true,
      avatar: true,
      headline: true,
      location: true,
      profileSkills: {
        select: { id: true, name: true, level: true, sortOrder: true },
        orderBy: [{ sortOrder: 'asc' as const }, { id: 'asc' as const }],
      },
      resume: {
        select: {
          data: true,
          predictedSeniority: true,
          predictedSeniorityMetadata: true,
        },
      },
    },
  },
  interviews: { orderBy: { round: 'asc' as const } },
  events: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: { actor: { select: { id: true, name: true } } },
  },
} satisfies Prisma.HiringApplicationInclude;

type StoredDetail = Prisma.HiringApplicationGetPayload<{
  include: typeof detailInclude;
}>;
type StoredResume = StoredDetail['applicant']['resume'];

/**
 * Reading one application for its detail page (the recruiter's applicant panel or the candidate's
 * "my application" page). Split from ApplicationsService, which changes applications.
 */
@Injectable()
export class ApplicationsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One application with its post card, the applicant, the resume, the interviews (by round) and the
   * history (oldest first, each with who did it).
   * Only the post's owner, an admin, or the applicant may see it; anyone else gets 403.
   * `viewerRole` tells the page which side it is drawing: 'candidate' for the applicant, else 'recruiter'.
   */
  async detail(id: number, viewer: Viewer) {
    const application = await this.prisma.hiringApplication.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!application) {
      throw new NotFoundException(`Hiring application with ID ${id} not found`);
    }
    const isApplicant = application.applicantId === viewer.id;
    const isOwner = application.hiringPost.recruiterId === viewer.id;
    if (!isApplicant && !isOwner && viewer.role !== Role.ADMIN) {
      throw new ForbiddenException('You cannot view this application.');
    }

    const counts = await pipelineCounts(this.prisma, [
      application.hiringPostId,
    ]);
    const { resume, ...applicant } = application.applicant;
    // The applicant sees "you applied" on the post card (unless they withdrew, then they may apply
    // again); a recruiter never applied to their own post, so for them it stays false.
    const applied =
      isApplicant && application.status !== HiringApplicationStatus.WITHDRAWN
        ? new Set([application.hiringPostId])
        : undefined;
    return {
      ...application,
      hiringPost: toHiringPostCard(application.hiringPost, applied, counts),
      applicant,
      resume: this.resumeSummary(resume, applicant.profileSkills),
      viewerRole: isApplicant ? ('candidate' as const) : ('recruiter' as const),
    };
  }

  /**
   * The part of the resume a recruiter reads on the applicant panel. Null when no resume is saved.
   * Occupation, level and years come from candidateCareer (the same numbers the candidate search shows:
   * the years the AI level was decided on). Before any AI result the years are counted from the jobs.
   * Skills are the applicant's profile skills (the one shared skill list).
   */
  private resumeSummary(
    resume: StoredResume,
    profileSkills: Array<{ name: string }>,
  ) {
    const career = candidateCareer(resume);
    if (!resume || !career) return null;
    const data = asRecord(resume.data);
    return {
      occupation: career.occupationCode,
      occupationTitle: career.occupationTitle,
      years: career.yearsInOccupation ?? yearsInOccupation(data),
      relatedYears: career.relatedYears ?? relatedYears(data),
      level: career.level,
      jobs: cleanResumeJobs(data.Jobs),
      degree: resumeEducation(data)?.degree ?? null,
      skills: profileSkills.map((skill) => skill.name),
    };
  }
}

export type ApplicationDetail = Awaited<
  ReturnType<ApplicationsQueryService['detail']>
>;

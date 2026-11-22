import { Injectable, Logger } from '@nestjs/common';
import {
  HiringApplicationStatus,
  InterviewStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { isActive } from './application-transitions';
import { HiringEventsService } from './hiring-events.service';

/** Why a post was swept: it is full (POSITION_FILLED) or the recruiter closed it (POST_CLOSED). */
export type SweepReason = 'POSITION_FILLED' | 'POST_CLOSED';

/** The statuses an application can still move forward from (APPLIED, REVIEWING, INTERVIEWING, OFFERED). */
const ACTIVE_STATUSES = Object.values(HiringApplicationStatus).filter(isActive);

/** Interviews that are not finished yet. */
const ACTIVE_INTERVIEW_STATUSES: InterviewStatus[] = [
  InterviewStatus.PROPOSED,
  InterviewStatus.RESCHEDULE_REQUESTED,
  InterviewStatus.SCHEDULED,
];

const SWEEP_MESSAGES: Record<
  SweepReason,
  (postTitle: string) => { title: string; body: string }
> = {
  POSITION_FILLED: (postTitle) => ({
    title: 'Position filled',
    body: `The ${postTitle} role has been filled. Thank you for applying.`,
  }),
  POST_CLOSED: (postTitle) => ({
    title: 'Post closed',
    body: `The ${postTitle} post is closed.`,
  }),
};

/**
 * The "sweep" of a post that is closing: everyone still in progress is told no.
 * It is used when the recruiter closes a post, and when the last opening is filled.
 */
@Injectable()
export class PostSweepService {
  private readonly logger = new Logger('PostSweepService');

  constructor(private readonly events: HiringEventsService) {}

  /**
   * Inside the caller's transaction (tx = a group of database changes saved together or not at all):
   *  1. every active application of the post becomes REJECTED with `statusReason` = reason;
   *  2. their interviews that are not finished become CANCELLED;
   *  3. one history row per rejected application and per cancelled interview.
   * HIRED, REJECTED, DECLINED and WITHDRAWN applications are left alone.
   * Returns the candidate (applicant) ids to notify after the transaction is saved (committed).
   */
  async sweep(
    tx: Prisma.TransactionClient,
    postId: number,
    reason: SweepReason,
    actorId: number,
  ): Promise<number[]> {
    const applications = await tx.hiringApplication.findMany({
      where: { hiringPostId: postId, status: { in: ACTIVE_STATUSES } },
      select: { id: true, applicantId: true },
      orderBy: { id: 'asc' },
    });
    if (!applications.length) return [];
    const applicationIds = applications.map((application) => application.id);

    // The status filter again, so a row changed since the read above is not touched.
    await tx.hiringApplication.updateMany({
      where: { id: { in: applicationIds }, status: { in: ACTIVE_STATUSES } },
      data: {
        status: HiringApplicationStatus.REJECTED,
        statusReason: reason,
        statusNote: null,
      },
    });

    const interviews = await tx.interview.findMany({
      where: {
        applicationId: { in: applicationIds },
        status: { in: ACTIVE_INTERVIEW_STATUSES },
      },
      select: { id: true, applicationId: true },
    });
    if (interviews.length) {
      await tx.interview.updateMany({
        where: { id: { in: interviews.map((interview) => interview.id) } },
        data: { status: InterviewStatus.CANCELLED, cancelledAt: new Date() },
      });
    }

    for (const application of applications) {
      await this.events.record(tx, {
        applicationId: application.id,
        actorId,
        type: 'rejected',
        data: { reason },
      });
    }
    for (const interview of interviews) {
      await this.events.record(tx, {
        applicationId: interview.applicationId,
        actorId,
        type: 'interview_cancelled',
        data: { interviewId: interview.id, reason },
      });
    }

    return applications.map((application) => application.applicantId);
  }

  /**
   * After commit: one notification to each swept candidate ("Position filled" or "Post closed").
   * One query finds their application ids (the notification links to the application).
   * It never throws: announce() only logs a failed notification.
   */
  async announceSwept(
    prisma: Pick<PrismaClient, 'hiringApplication'>,
    input: {
      postId: number;
      postTitle: string;
      reason: SweepReason;
      actorId: number;
      candidateIds: number[];
    },
  ): Promise<void> {
    if (!input.candidateIds.length) return;
    let applications: { id: number; applicantId: number }[];
    try {
      applications = await prisma.hiringApplication.findMany({
        where: {
          hiringPostId: input.postId,
          applicantId: { in: input.candidateIds },
        },
        select: { id: true, applicantId: true },
      });
    } catch (error) {
      // The sweep is already saved; a failed lookup only means no notifications.
      this.logger.error(
        `Could not load swept applications of post ${input.postId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    const message = SWEEP_MESSAGES[input.reason](input.postTitle);
    for (const application of applications) {
      await this.events.announce({
        recipientId: application.applicantId,
        actorId: input.actorId,
        kind: 'application',
        title: message.title,
        body: message.body,
        applicationId: application.id,
        postId: input.postId,
        forRecruiter: false,
      });
    }
  }
}

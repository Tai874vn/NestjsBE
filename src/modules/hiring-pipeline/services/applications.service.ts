import { ConflictException, Injectable } from '@nestjs/common';
import {
  HiringApplicationStatus,
  HiringPostStatus,
  InterviewStatus,
  Prisma,
} from '@prisma/client';
import {
  ApplicationPipelineService,
  LockedApplication,
} from './application-pipeline.service';
import { Actor } from '../utils/application-transitions';
import { ApplicationsQueryService, Viewer } from './applications-query.service';
import { HiringEventsService } from './hiring-events.service';
import {
  ACTIVE_INTERVIEW_STATUSES,
  PostSweepService,
} from './post-sweep.service';

const S = HiringApplicationStatus;

/**
 * The recruiter's and the candidate's actions on one application: shortlist, reject, offer, withdraw
 * the offer, accept, decline, withdraw. Reading the detail is in ApplicationsQueryService; the
 * interview actions are in InterviewsService.
 *
 * Each action is a "step" run by ApplicationPipelineService.run(): lock the application row, check the
 * rules (403 / 409), write the change and its history row in one transaction, then tell the other side.
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly pipeline: ApplicationPipelineService,
    private readonly events: HiringEventsService,
    private readonly sweeper: PostSweepService,
    private readonly query: ApplicationsQueryService,
  ) {}

  async findOne(id: number, viewer: Viewer) {
    return {
      message: 'Get hiring application successfully',
      content: await this.query.detail(id, viewer),
    };
  }

  /** Recruiter: APPLIED → REVIEWING (on the shortlist). */
  shortlist(id: number, viewer: Viewer) {
    return this.pipeline.run(id, viewer, {
      action: 'shortlist',
      message: 'Applicant shortlisted',
      write: async ({ tx, application }) => {
        await this.setStatus(tx, application.id, { status: S.REVIEWING });
        await this.events.record(tx, {
          applicationId: application.id,
          actorId: viewer.id,
          type: 'shortlisted',
        });
      },
      notice: (application) => ({
        recipientId: application.applicantId,
        kind: 'application',
        title: 'You are on the shortlist',
        body: `${application.hiringPost.recruiter.name} shortlisted you for ${application.hiringPost.title}.`,
        forRecruiter: false,
      }),
    });
  }

  /** Recruiter: APPLIED, REVIEWING or INTERVIEWING → REJECTED; an interview in progress is cancelled. */
  reject(id: number, viewer: Viewer, note?: string) {
    return this.pipeline.run(id, viewer, {
      action: 'reject',
      message: 'Applicant rejected',
      write: async ({ tx, application, actor, now }) => {
        await this.setStatus(tx, application.id, {
          status: S.REJECTED,
          statusReason: null,
          statusNote: note ?? null,
        });
        await this.events.record(tx, {
          applicationId: application.id,
          actorId: viewer.id,
          type: 'rejected',
          data: { reason: null, ...(note ? { note } : {}) },
        });
        await this.cancelActiveInterview(
          tx,
          application,
          viewer.id,
          now,
          actor,
        );
      },
      notice: (application) => ({
        recipientId: application.applicantId,
        kind: 'application',
        title: 'Application update',
        body: `${application.hiringPost.title}: not selected.${note ? ` ${note}` : ''}`,
        forRecruiter: false,
      }),
    });
  }

  /**
   * Recruiter: INTERVIEWING → OFFERED. The rules need a finished interview, none in progress, and an
   * opening left: openings − (hired + offers waiting). A post with no limit (openings null) always has one.
   * The post row is locked first (as in acceptOffer), and the openings are counted after the locks, so two
   * offers sent at the same moment are done one after the other and never go past the openings.
   */
  sendOffer(id: number, viewer: Viewer, note?: string) {
    return this.pipeline.run(id, viewer, {
      action: 'sendOffer',
      message: 'Offer sent',
      lockPost: true,
      write: async ({ tx, application, now }) => {
        await this.setStatus(tx, application.id, {
          status: S.OFFERED,
          offerNote: note ?? null,
          offeredAt: now,
          decidedAt: null,
        });
        await this.events.record(tx, {
          applicationId: application.id,
          actorId: viewer.id,
          type: 'offer_sent',
          ...(note ? { data: { note } } : {}),
        });
      },
      notice: (application) => ({
        recipientId: application.applicantId,
        kind: 'application',
        title: 'Offer received',
        body: `${application.hiringPost.recruiter.name} sent you an offer for ${application.hiringPost.title}.`,
        forRecruiter: false,
        chat: `Offer for ${application.hiringPost.title}: ${note ?? 'details to follow in chat'}`,
        chatBetween: {
          recruiterId: application.hiringPost.recruiterId,
          candidateId: application.applicantId,
        },
      }),
    });
  }

  /** Recruiter: OFFERED → INTERVIEWING (the offer is taken back; the opening is free again). */
  withdrawOffer(id: number, viewer: Viewer) {
    return this.pipeline.run(id, viewer, {
      action: 'withdrawOffer',
      message: 'Offer withdrawn',
      write: async ({ tx, application }) => {
        await this.setStatus(tx, application.id, {
          status: S.INTERVIEWING,
          offerNote: null,
          offeredAt: null,
        });
        await this.events.record(tx, {
          applicationId: application.id,
          actorId: viewer.id,
          type: 'offer_withdrawn',
        });
      },
      notice: (application) => ({
        recipientId: application.applicantId,
        kind: 'application',
        title: 'Offer withdrawn',
        body: `The offer for ${application.hiringPost.title} was withdrawn.`,
        forRecruiter: false,
      }),
    });
  }

  /**
   * Candidate: OFFERED → HIRED. The post row is locked first, so two candidates taking the last opening
   * at once are done one after the other: the second gets 409 "This position has just been filled.".
   * When the hired count reaches the openings, the post is closed and swept (everyone still in
   * progress is told the position is filled).
   */
  acceptOffer(id: number, viewer: Viewer) {
    let hiredBefore = 0;
    return this.pipeline.run(id, viewer, {
      action: 'acceptOffer',
      message: 'Offer accepted',
      lockPost: true,
      // When every opening is already hired, say so (409) before the status rules. This is what the
      // second of two candidates taking the last opening sees: the first accept closed the post and
      // swept this application (REJECTED with reason POSITION_FILLED), but "just been filled" is the
      // true reason. Only an offer still waiting, or one swept that way, gets this answer; any other
      // status (for example withdrawn) gets the normal answer from the status rules.
      before: async ({ tx, application, actor }) => {
        if (actor !== 'candidate') return; // the rules answer 403
        const sweptAsFilled =
          application.status === S.REJECTED &&
          application.statusReason === 'POSITION_FILLED';
        if (application.status !== S.OFFERED && !sweptAsFilled) return;
        hiredBefore = await tx.hiringApplication.count({
          where: { hiringPostId: application.hiringPostId, status: S.HIRED },
        });
        const { openings } = application.hiringPost;
        if (openings !== null && hiredBefore >= openings) {
          throw new ConflictException('This position has just been filled.');
        }
      },
      write: async ({ tx, application, now }) => {
        await this.setStatus(tx, application.id, {
          status: S.HIRED,
          decidedAt: now,
        });
        await this.events.record(tx, {
          applicationId: application.id,
          actorId: viewer.id,
          type: 'hired',
        });
        const { openings, id: postId, title } = application.hiringPost;
        if (openings === null || hiredBefore + 1 < openings) return;
        await tx.hiringPost.update({
          where: { id: postId },
          data: { status: HiringPostStatus.CLOSED },
        });
        const candidateIds = await this.sweeper.sweep(
          tx,
          postId,
          'POSITION_FILLED',
          viewer.id,
        );
        return {
          postId,
          postTitle: title,
          reason: 'POSITION_FILLED',
          candidateIds,
        };
      },
      notice: (application) => ({
        recipientId: application.hiringPost.recruiterId,
        kind: 'application',
        title: 'Offer accepted',
        body: `${application.applicant.name} accepted the offer for ${application.hiringPost.title}.`,
        forRecruiter: true,
      }),
    });
  }

  /** Candidate: OFFERED → DECLINED, with an optional note for the recruiter. */
  declineOffer(id: number, viewer: Viewer, note?: string) {
    return this.pipeline.run(id, viewer, {
      action: 'declineOffer',
      message: 'Offer declined',
      write: async ({ tx, application, now }) => {
        await this.setStatus(tx, application.id, {
          status: S.DECLINED,
          decidedAt: now,
          statusReason: null,
          statusNote: note ?? null,
        });
        await this.events.record(tx, {
          applicationId: application.id,
          actorId: viewer.id,
          type: 'offer_declined',
          ...(note ? { data: { note } } : {}),
        });
      },
      notice: (application) => ({
        recipientId: application.hiringPost.recruiterId,
        kind: 'application',
        title: 'Offer declined',
        body: `${application.applicant.name} declined the offer for ${application.hiringPost.title}.${note ? ` ${note}` : ''}`,
        forRecruiter: true,
      }),
    });
  }

  /** Candidate: any active status → WITHDRAWN; an interview in progress is cancelled. */
  withdraw(id: number, viewer: Viewer) {
    return this.pipeline.run(id, viewer, {
      action: 'withdraw',
      message: 'Application withdrawn',
      write: async ({ tx, application, actor, now }) => {
        await this.setStatus(tx, application.id, {
          status: S.WITHDRAWN,
          statusReason: null,
          statusNote: null,
        });
        await this.events.record(tx, {
          applicationId: application.id,
          actorId: viewer.id,
          type: 'withdrawn',
        });
        await this.cancelActiveInterview(
          tx,
          application,
          viewer.id,
          now,
          actor,
        );
      },
      notice: (application) => ({
        recipientId: application.hiringPost.recruiterId,
        kind: 'application',
        title: 'Application withdrawn',
        body: `${application.applicant.name} withdrew the application for ${application.hiringPost.title}.`,
        forRecruiter: true,
      }),
    });
  }

  private async setStatus(
    tx: Prisma.TransactionClient,
    id: number,
    data: Prisma.HiringApplicationUpdateInput,
  ) {
    await tx.hiringApplication.update({ where: { id }, data });
  }

  /**
   * Cancel the interview in progress (PROPOSED, RESCHEDULE_REQUESTED or SCHEDULED), if any, with its
   * history row. The status filter is there again so a finished interview is never changed.
   * `by` is the side that caused it: 'recruiter' when rejecting, 'candidate' when withdrawing.
   */
  private async cancelActiveInterview(
    tx: Prisma.TransactionClient,
    application: LockedApplication,
    actorId: number,
    now: Date,
    by: Actor,
  ) {
    const active = application.interviews.find((interview) =>
      ACTIVE_INTERVIEW_STATUSES.includes(interview.status),
    );
    if (!active) return;
    await tx.interview.updateMany({
      where: { id: active.id, status: { in: ACTIVE_INTERVIEW_STATUSES } },
      data: { status: InterviewStatus.CANCELLED, cancelledAt: now },
    });
    await this.events.record(tx, {
      applicationId: application.id,
      actorId,
      type: 'interview_cancelled',
      data: { interviewId: active.id, by },
    });
  }
}

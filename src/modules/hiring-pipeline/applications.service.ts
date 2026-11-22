import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HiringApplicationStatus,
  HiringPostStatus,
  InterviewStatus,
  Prisma,
} from '@prisma/client';
import { Role } from '../../common/constants/roles';
import { PrismaService } from '../../prisma.service';
import {
  Actor,
  nextStatus,
  PipelineAction,
  TransitionError,
} from './application-transitions';
import { ApplicationsQueryService, Viewer } from './applications-query.service';
import { AnnounceInput, HiringEventsService } from './hiring-events.service';
import {
  ACTIVE_INTERVIEW_STATUSES,
  PostSweepService,
} from './post-sweep.service';

const S = HiringApplicationStatus;

/** What a step reads from the application after locking it. */
const lockedInclude = {
  hiringPost: {
    select: {
      id: true,
      title: true,
      status: true,
      openings: true,
      recruiterId: true,
      recruiter: { select: { name: true } },
    },
  },
  applicant: { select: { name: true } },
  interviews: { select: { id: true, status: true } },
} satisfies Prisma.HiringApplicationInclude;

type LockedApplication = Prisma.HiringApplicationGetPayload<{
  include: typeof lockedInclude;
}>;

/** Everything a step needs: the transaction, the locked application, which side acts, and when. */
type StepInput = {
  tx: Prisma.TransactionClient;
  application: LockedApplication;
  actor: Actor;
  now: Date;
};

/** A swept post, to announce after commit (see PostSweepService.announceSwept). */
type Swept = { postId: number; postTitle: string; candidateIds: number[] };

type Step = {
  action: PipelineAction;
  /** Lock the post row too (send and accept offer; the post is locked before the application). */
  lockPost?: boolean;
  /** An extra check that runs before the transition rules (inside the transaction). */
  before?: (input: StepInput) => Promise<void>;
  /** Write the new status and its history rows; may return a sweep to announce. */
  write: (input: StepInput) => Promise<Swept | void>;
  /** The notification to send after commit. */
  notice: (
    application: LockedApplication,
  ) => Omit<AnnounceInput, 'actorId' | 'applicationId' | 'postId'>;
  message: string;
};

/**
 * The recruiter's and the candidate's actions on one application: shortlist, reject, offer, withdraw
 * the offer, accept, decline, withdraw. Reading the detail is in ApplicationsQueryService.
 *
 * Each action runs the same way (see run()):
 *  1. A transaction (a group of database changes saved together or not at all) locks the application
 *     row with SELECT ... FOR UPDATE ("this row is mine until the transaction ends"), so two clicks at
 *     the same time are done one after the other. Sending or accepting an offer locks the post row first.
 *  2. It reads the application again (now nobody else can change it) and asks the transition rules
 *     (application-transitions.ts) whether the action is allowed: wrong person 403, wrong status 409.
 *  3. It writes the new status and the history row (HiringApplicationEvent) in the same transaction.
 *  4. After the save (commit), the other side is told (notification, and a chat message for an offer).
 */
@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
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
    return this.run(id, viewer, {
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
    return this.run(id, viewer, {
      action: 'reject',
      message: 'Applicant rejected',
      write: async ({ tx, application, now }) => {
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
        await this.cancelActiveInterview(tx, application, viewer.id, now);
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
    return this.run(id, viewer, {
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
    return this.run(id, viewer, {
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
    return this.run(id, viewer, {
      action: 'acceptOffer',
      message: 'Offer accepted',
      lockPost: true,
      // When every opening is already hired, say so (409) before the status rules. This is what the
      // second of two candidates taking the last opening sees: the first accept closed the post and
      // swept this application, but "just been filled" is the true reason.
      before: async ({ tx, application, actor }) => {
        if (actor !== 'candidate') return; // the rules answer 403
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
        return { postId, postTitle: title, candidateIds };
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
    return this.run(id, viewer, {
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
    return this.run(id, viewer, {
      action: 'withdraw',
      message: 'Application withdrawn',
      write: async ({ tx, application, now }) => {
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
        await this.cancelActiveInterview(tx, application, viewer.id, now);
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

  /** The shared steps of every action (see the class comment). */
  private async run(id: number, viewer: Viewer, step: Step) {
    const { application, swept } = await this.prisma.$transaction(
      async (tx) => {
        const application = await this.lockAndLoad(tx, id, step.lockPost);
        const actor = this.actorOf(application, viewer);
        const input: StepInput = { tx, application, actor, now: new Date() };
        await step.before?.(input);
        await this.assertAllowed(tx, step.action, actor, application);
        const swept = await step.write(input);
        return { application, swept };
      },
    );

    // After commit: tell the other side; announce() never throws.
    await this.events.announce({
      ...step.notice(application),
      actorId: viewer.id,
      applicationId: application.id,
      postId: application.hiringPostId,
    });
    if (swept && swept.candidateIds.length) {
      await this.sweeper.announceSwept(this.prisma, {
        ...swept,
        reason: 'POSITION_FILLED',
        actorId: viewer.id,
      });
    }

    return {
      message: step.message,
      content: await this.query.detail(id, viewer),
    };
  }

  /**
   * Lock the row(s), then read the application again. For an offer or accept, the post is locked BEFORE the
   * application: closing a post also takes the post row first, so both always take the locks in the
   * same order and can never wait on each other forever (a "deadlock").
   */
  private async lockAndLoad(
    tx: Prisma.TransactionClient,
    id: number,
    lockPost = false,
  ): Promise<LockedApplication> {
    if (lockPost) {
      // The post id of an application never changes, so it is safe to read before the lock.
      const found = await tx.hiringApplication.findUnique({
        where: { id },
        select: { hiringPostId: true },
      });
      if (!found) throw this.notFound(id);
      await tx.$queryRaw`SELECT id FROM "hiring_posts" WHERE id = ${found.hiringPostId} FOR UPDATE`;
    }
    await tx.$queryRaw`SELECT id FROM "hiring_applications" WHERE id = ${id} FOR UPDATE`;
    const application = await tx.hiringApplication.findUnique({
      where: { id },
      include: lockedInclude,
    });
    if (!application) throw this.notFound(id);
    return application;
  }

  /**
   * Which side the user is on: the applicant is the candidate; the post owner or an admin is the
   * recruiter; anyone else may not touch the application (403).
   */
  private actorOf(application: LockedApplication, viewer: Viewer): Actor {
    if (application.applicantId === viewer.id) return 'candidate';
    if (
      application.hiringPost.recruiterId === viewer.id ||
      viewer.role === Role.ADMIN
    ) {
      return 'recruiter';
    }
    throw new ForbiddenException('You cannot act on this application.');
  }

  /** Ask the transition rules; their errors become 403 (wrong person) or 409 (wrong status). */
  private async assertAllowed(
    tx: Prisma.TransactionClient,
    action: PipelineAction,
    actor: Actor,
    application: LockedApplication,
  ) {
    const { openings } = application.hiringPost;
    let openingsLeft: number | null = null;
    if (action === 'sendOffer' && openings !== null) {
      const taken = await tx.hiringApplication.count({
        where: {
          hiringPostId: application.hiringPostId,
          status: { in: [S.HIRED, S.OFFERED] },
        },
      });
      openingsLeft = openings - taken;
    }
    try {
      nextStatus(action, actor, application.status, {
        hasCompletedInterview: application.interviews.some(
          (interview) => interview.status === InterviewStatus.COMPLETED,
        ),
        hasActiveInterview: application.interviews.some((interview) =>
          ACTIVE_INTERVIEW_STATUSES.includes(interview.status),
        ),
        postOpen: application.hiringPost.status === HiringPostStatus.OPEN,
        openingsLeft,
      });
    } catch (error) {
      if (error instanceof TransitionError) {
        throw error.kind === 'forbidden'
          ? new ForbiddenException(error.message)
          : new ConflictException(error.message);
      }
      throw error;
    }
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
   */
  private async cancelActiveInterview(
    tx: Prisma.TransactionClient,
    application: LockedApplication,
    actorId: number,
    now: Date,
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
      data: { interviewId: active.id },
    });
  }

  private notFound(id: number) {
    return new NotFoundException(`Hiring application with ID ${id} not found`);
  }
}

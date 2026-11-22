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
  SweepReason,
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
  interviews: { select: { id: true, status: true, round: true } },
} satisfies Prisma.HiringApplicationInclude;

export type LockedApplication = Prisma.HiringApplicationGetPayload<{
  include: typeof lockedInclude;
}>;

/** Everything a step needs: the transaction, the locked application, which side acts, and when. */
export type StepInput = {
  tx: Prisma.TransactionClient;
  application: LockedApplication;
  actor: Actor;
  now: Date;
};

/** A swept post, to announce after commit (see PostSweepService.announceSwept). */
export type Swept = {
  postId: number;
  postTitle: string;
  /** Why the post was swept; the candidates' notification says it ("Position filled" or "Post closed"). */
  reason: SweepReason;
  candidateIds: number[];
};

/** The notification of a step, without the parts run() fills in. */
export type StepNotice = Omit<
  AnnounceInput,
  'actorId' | 'applicationId' | 'postId'
>;

export type Step = {
  /**
   * The rule in application-transitions.ts to check. An interview step (new times, accept, ...) has
   * none: it does its own checks in `before`, because it changes the interview, not the application.
   */
  action?: PipelineAction;
  /** Lock the post row too (send and accept offer; the post is locked before the application). */
  lockPost?: boolean;
  /** An extra check that runs before the transition rules (inside the transaction). */
  before?: (input: StepInput) => Promise<void>;
  /** Write the new status and its history rows; may return a sweep to announce. */
  write: (input: StepInput) => Promise<Swept | void>;
  /** The notification to send after commit; null sends none. */
  notice: (application: LockedApplication, actor: Actor) => StepNotice | null;
  message: string;
};

/**
 * The shared way every action on an application runs (used by ApplicationsService and
 * InterviewsService), see run():
 *  1. A transaction (a group of database changes saved together or not at all) locks the application
 *     row with SELECT ... FOR UPDATE ("this row is mine until the transaction ends"), so two clicks at
 *     the same time are done one after the other. Sending or accepting an offer locks the post row first.
 *     Interview actions lock the application row too, so one application's interviews change one at a time.
 *  2. It reads the application again (now nobody else can change it), finds which side the user is on,
 *     and asks the transition rules (application-transitions.ts) whether the action is allowed:
 *     wrong person 403, wrong status 409.
 *  3. It writes the new status and the history row (HiringApplicationEvent) in the same transaction.
 *  4. After the save (commit), the other side is told (notification, and a chat message for some steps).
 */
@Injectable()
export class ApplicationPipelineService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: HiringEventsService,
    private readonly sweeper: PostSweepService,
    private readonly query: ApplicationsQueryService,
  ) {}

  /** The shared steps of every action (see the class comment). Answers { message, content: detail }. */
  async run(id: number, viewer: Viewer, step: Step) {
    const { application, actor, swept } = await this.prisma.$transaction(
      async (tx) => {
        const application = await this.lockAndLoad(tx, id, step.lockPost);
        const actor = this.actorOf(application, viewer);
        const input: StepInput = { tx, application, actor, now: new Date() };
        await step.before?.(input);
        if (step.action) {
          await this.assertAllowed(tx, step.action, actor, application);
        }
        const swept = await step.write(input);
        return { application, actor, swept };
      },
    );

    // After commit: tell the other side; announce() never throws.
    const notice = step.notice(application, actor);
    if (notice) {
      await this.events.announce({
        ...notice,
        actorId: viewer.id,
        applicationId: application.id,
        postId: application.hiringPostId,
      });
    }
    if (swept && swept.candidateIds.length) {
      await this.sweeper.announceSwept(this.prisma, {
        ...swept,
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

  private notFound(id: number) {
    return new NotFoundException(`Hiring application with ID ${id} not found`);
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HiringApplicationStatus,
  HiringPostStatus,
  Interview,
  InterviewMode,
  InterviewStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import {
  ApplicationPipelineService,
  LockedApplication,
  StepInput,
  StepNotice,
} from './application-pipeline.service';
import { Actor } from '../utils/application-transitions';
import { Viewer } from './applications-query.service';
import { HiringEventsService } from './hiring-events.service';
import {
  formatVietnamTime,
  interviewTimesText,
  parseProposedTimes,
} from '../utils/interview-times';
import { ACTIVE_INTERVIEW_STATUSES } from './post-sweep.service';

const I = InterviewStatus;

/** What the recruiter sends to request an interview (already checked by RequestInterviewDto). */
export type RequestInterviewInput = {
  mode: InterviewMode;
  proposedTimes: string[];
  durationMinutes?: number;
  location?: string;
  note?: string;
};

/** Upcoming interviews start from 2 hours ago, so one that is going on right now still shows. */
const UPCOMING_FROM_MS = 2 * 60 * 60 * 1000;
const UPCOMING_LIMIT = 20;

/** Words for the wrong-status sentence (409), like STATUS_LABEL in application-transitions.ts. */
const INTERVIEW_LABEL: Record<InterviewStatus, string> = {
  PROPOSED: 'waiting for the candidate to pick a time',
  RESCHEDULE_REQUESTED: 'waiting for new times',
  SCHEDULED: 'scheduled',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};
const FINISHED: InterviewStatus[] = [I.COMPLETED, I.CANCELLED];

/**
 * The interview actions: request (on an application), new times, accept a time, ask for other times,
 * cancel, complete, and the list of upcoming interviews.
 *
 * Every change runs through ApplicationPipelineService.run() on the interview's APPLICATION: the
 * application row is locked (SELECT ... FOR UPDATE), so two clicks on one application's interviews are
 * done one after the other; then the interview is read again inside the transaction and checked.
 */
@Injectable()
export class InterviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: HiringEventsService,
    private readonly pipeline: ApplicationPipelineService,
  ) {}

  /**
   * Recruiter: a new interview (PROPOSED) with 1-3 times; the application becomes INTERVIEWING.
   * The round is the highest round so far + 1. The rules allow it from APPLIED, REVIEWING or
   * INTERVIEWING when no interview is in progress. Two requests at the very same moment are stopped by
   * the partial unique index (Prisma error P2002), which gives the same 409.
   */
  async requestInterview(
    applicationId: number,
    viewer: Viewer,
    input: RequestInterviewInput,
  ) {
    const proposedTimes = parseProposedTimes(input.proposedTimes);
    const location = input.location?.trim() || null;
    if (input.mode === InterviewMode.ONSITE && !location) {
      throw new BadRequestException(
        'location is needed for an onsite interview.',
      );
    }
    const durationMinutes = input.durationMinutes ?? 45;
    const details = { mode: input.mode, durationMinutes, location };

    try {
      return await this.pipeline.run(applicationId, viewer, {
        action: 'requestInterview',
        message: 'Interview requested',
        write: async ({ tx, application }) => {
          const round =
            Math.max(0, ...application.interviews.map((row) => row.round)) + 1;
          const interview = await tx.interview.create({
            data: {
              applicationId: application.id,
              round,
              ...details,
              note: input.note ?? null,
              proposedTimes,
              createdById: viewer.id,
            },
          });
          await tx.hiringApplication.update({
            where: { id: application.id },
            data: { status: HiringApplicationStatus.INTERVIEWING },
          });
          await this.events.record(tx, {
            applicationId: application.id,
            actorId: viewer.id,
            type: 'interview_requested',
            data: {
              interviewId: interview.id,
              round,
              mode: input.mode,
              proposedTimes: proposedTimes.map((time) => time.toISOString()),
            },
          });
        },
        notice: (application) => ({
          recipientId: application.applicantId,
          kind: 'interview',
          title: 'Interview request',
          proposedTimes: proposedTimes.map((time) => time.toISOString()),
          body: `${application.hiringPost.recruiter.name} invited you to an interview for ${application.hiringPost.title}. Pick one of the times.`,
          forRecruiter: false,
          ...this.chatFromRecruiter(
            application,
            `Interview request for ${application.hiringPost.title}: ${interviewTimesText(proposedTimes, details)}`,
          ),
        }),
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This application already has an interview in progress.',
        );
      }
      throw error;
    }
  }

  /** Recruiter: new times (after the candidate asked, or to change them) → PROPOSED. */
  async proposeTimes(id: number, viewer: Viewer, times: string[]) {
    const proposedTimes = parseProposedTimes(times);
    return this.runOnInterview(id, viewer, {
      by: 'recruiter',
      from: [I.PROPOSED, I.RESCHEDULE_REQUESTED],
      message: 'New interview times sent',
      write: async ({ tx, application }, interview) => {
        await tx.interview.update({
          where: { id: interview.id },
          data: { status: I.PROPOSED, proposedTimes, rescheduleNote: null },
        });
        await this.events.record(tx, {
          applicationId: application.id,
          actorId: viewer.id,
          type: 'interview_times_proposed',
          data: {
            interviewId: interview.id,
            proposedTimes: proposedTimes.map((time) => time.toISOString()),
          },
        });
      },
      notice: (application, _actor, interview) => ({
        recipientId: application.applicantId,
        kind: 'interview',
        title: 'New interview times',
        proposedTimes: proposedTimes.map((time) => time.toISOString()),
        body: `${application.hiringPost.recruiter.name} sent new interview times for ${application.hiringPost.title}.`,
        forRecruiter: false,
        ...this.chatFromRecruiter(
          application,
          `New interview times for ${application.hiringPost.title}: ${interviewTimesText(proposedTimes, interview)}`,
        ),
      }),
    });
  }

  /** Candidate: pick one of the offered times → SCHEDULED. The time must be offered and still ahead. */
  async accept(id: number, viewer: Viewer, startsAt: string) {
    const picked = new Date(startsAt);
    if (Number.isNaN(picked.getTime())) {
      throw new BadRequestException('startsAt must be a valid date.');
    }
    return this.runOnInterview(id, viewer, {
      by: 'candidate',
      from: [I.PROPOSED],
      message: 'Interview booked',
      check: ({ now }, interview) => {
        const offered = interview.proposedTimes.some(
          (time) => time.getTime() === picked.getTime(),
        );
        if (!offered) {
          throw new BadRequestException(
            'startsAt must be one of the offered times.',
          );
        }
        if (picked.getTime() <= now.getTime()) {
          throw new BadRequestException(
            'That time has passed. Ask for new times.',
          );
        }
      },
      write: async ({ tx, application }, interview) => {
        await tx.interview.update({
          where: { id: interview.id },
          data: { status: I.SCHEDULED, scheduledAt: picked },
        });
        await this.events.record(tx, {
          applicationId: application.id,
          actorId: viewer.id,
          type: 'interview_booked',
          data: {
            interviewId: interview.id,
            scheduledAt: picked.toISOString(),
          },
        });
      },
      notice: (application) => ({
        recipientId: application.hiringPost.recruiterId,
        kind: 'interview',
        title: 'Interview booked',
        scheduledAt: picked.toISOString(),
        body: `${application.applicant.name} picked ${formatVietnamTime(picked)} (Vietnam time) for the ${application.hiringPost.title} interview.`,
        forRecruiter: true,
      }),
    });
  }

  /** Candidate: none of the times work → RESCHEDULE_REQUESTED, with an optional note. */
  requestReschedule(id: number, viewer: Viewer, note?: string) {
    return this.runOnInterview(id, viewer, {
      by: 'candidate',
      from: [I.PROPOSED],
      message: 'Other interview times asked',
      write: async ({ tx, application }, interview) => {
        await tx.interview.update({
          where: { id: interview.id },
          data: {
            status: I.RESCHEDULE_REQUESTED,
            rescheduleNote: note ?? null,
          },
        });
        await this.events.record(tx, {
          applicationId: application.id,
          actorId: viewer.id,
          type: 'interview_reschedule_requested',
          data: { interviewId: interview.id, ...(note ? { note } : {}) },
        });
      },
      notice: (application) => ({
        recipientId: application.hiringPost.recruiterId,
        kind: 'interview',
        title: 'Other interview times asked',
        body: `${application.applicant.name} asked for other interview times for ${application.hiringPost.title}.${note ? ` ${note}` : ''}`,
        forRecruiter: true,
      }),
    });
  }

  /** Either side: an interview in progress → CANCELLED; the other side is told. */
  cancel(id: number, viewer: Viewer, note?: string) {
    return this.runOnInterview(id, viewer, {
      by: 'either',
      from: ACTIVE_INTERVIEW_STATUSES,
      message: 'Interview cancelled',
      write: async ({ tx, application, actor, now }, interview) => {
        await tx.interview.update({
          where: { id: interview.id },
          data: { status: I.CANCELLED, cancelledAt: now },
        });
        await this.events.record(tx, {
          applicationId: application.id,
          actorId: viewer.id,
          type: 'interview_cancelled',
          data: {
            interviewId: interview.id,
            by: actor,
            ...(note ? { note } : {}),
          },
        });
      },
      notice: (application, actor) => ({
        recipientId:
          actor === 'recruiter'
            ? application.applicantId
            : application.hiringPost.recruiterId,
        kind: 'interview',
        title: 'Interview cancelled',
        body: `The interview for ${application.hiringPost.title} was cancelled.${note ? ` ${note}` : ''}`,
        forRecruiter: actor === 'candidate',
      }),
    });
  }

  /** Recruiter: SCHEDULED → COMPLETED (the interview happened, or the Skip button). */
  complete(id: number, viewer: Viewer) {
    return this.runOnInterview(id, viewer, {
      by: 'recruiter',
      from: [I.SCHEDULED],
      message: 'Interview completed',
      write: async ({ tx, application, now }, interview) => {
        await tx.interview.update({
          where: { id: interview.id },
          data: { status: I.COMPLETED, completedAt: now },
        });
        await this.events.record(tx, {
          applicationId: application.id,
          actorId: viewer.id,
          type: 'interview_completed',
          data: { interviewId: interview.id },
        });
      },
      notice: (application) => ({
        recipientId: application.applicantId,
        kind: 'interview',
        title: 'Interview done',
        body: `The interview for ${application.hiringPost.title} is marked as done.`,
        forRecruiter: false,
      }),
    });
  }

  /**
   * The viewer's SCHEDULED interviews, as the recruiter (post owner) or the candidate (applicant),
   * from 2 hours ago on, soonest first, at most 20. Each has the post and the other person.
   */
  async upcoming(viewer: Viewer) {
    const rows = await this.prisma.interview.findMany({
      where: {
        status: I.SCHEDULED,
        scheduledAt: { gte: new Date(Date.now() - UPCOMING_FROM_MS) },
        application: {
          OR: [
            { applicantId: viewer.id },
            { hiringPost: { recruiterId: viewer.id } },
          ],
        },
      },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: UPCOMING_LIMIT,
      include: {
        application: {
          select: {
            id: true,
            applicantId: true,
            applicant: { select: { id: true, name: true, avatar: true } },
            hiringPost: {
              select: {
                id: true,
                title: true,
                companyName: true,
                recruiterId: true,
                recruiter: { select: { id: true, name: true, avatar: true } },
              },
            },
          },
        },
      },
    });

    return {
      message: 'Get upcoming interviews successfully',
      content: rows.map(({ application, ...interview }) => {
        const isCandidate = application.applicantId === viewer.id;
        const { hiringPost } = application;
        return {
          ...interview,
          applicationId: application.id,
          post: {
            id: hiringPost.id,
            title: hiringPost.title,
            companyName: hiringPost.companyName,
          },
          otherPerson: isCandidate
            ? hiringPost.recruiter
            : application.applicant,
          viewerRole: isCandidate
            ? ('candidate' as const)
            : ('recruiter' as const),
        };
      }),
    };
  }

  /**
   * Run one interview action: find the interview's application, run the pipeline on it (lock, which
   * side), then inside the transaction read the interview again and check: the right side (403),
   * the post still open (409), the interview status (409), then the action's own check.
   */
  private async runOnInterview(
    id: number,
    viewer: Viewer,
    action: {
      by: Actor | 'either';
      from: InterviewStatus[];
      message: string;
      check?: (input: StepInput, interview: Interview) => void;
      write: (input: StepInput, interview: Interview) => Promise<void>;
      notice: (
        application: LockedApplication,
        actor: Actor,
        interview: Interview,
      ) => StepNotice;
    },
  ) {
    const found = await this.prisma.interview.findUnique({
      where: { id },
      select: { applicationId: true },
    });
    if (!found)
      throw new NotFoundException(`Interview with ID ${id} not found`);

    let interview: Interview | null = null;
    return this.pipeline.run(found.applicationId, viewer, {
      message: action.message,
      before: async (input) => {
        interview = await input.tx.interview.findUnique({ where: { id } });
        if (!interview) {
          throw new NotFoundException(`Interview with ID ${id} not found`);
        }
        if (action.by !== 'either' && action.by !== input.actor) {
          throw new ForbiddenException(
            'You are not allowed to do this on this interview.',
          );
        }
        if (input.application.hiringPost.status !== HiringPostStatus.OPEN) {
          throw new ConflictException('This hiring post is closed.');
        }
        if (!action.from.includes(interview.status)) {
          throw new ConflictException(
            FINISHED.includes(interview.status)
              ? `This interview was already ${INTERVIEW_LABEL[interview.status]}.`
              : `This interview is ${INTERVIEW_LABEL[interview.status]} right now.`,
          );
        }
        action.check?.(input, interview);
      },
      write: (input) => action.write(input, interview!),
      notice: (application, actor) =>
        action.notice(application, actor, interview!),
    });
  }

  /** A chat message sent by the recruiter in the direct room with the candidate. */
  private chatFromRecruiter(application: LockedApplication, chat: string) {
    return {
      chat,
      chatBetween: {
        recruiterId: application.hiringPost.recruiterId,
        candidateId: application.applicantId,
      },
    };
  }
}

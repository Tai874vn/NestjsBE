/**
 * Pure status transition rules for hiring applications in the hiring-pipeline module.
 * Checks actor permissions, post status, interview progress, and remaining openings to return the next status or throw TransitionError.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/modules/hiring-pipeline/services/application-pipeline.service.ts
 *   - src/modules/hiring-pipeline/services/applications.service.ts
 *   - src/modules/hiring-pipeline/services/interviews.service.ts
 *   - src/modules/hiring-pipeline/services/post-sweep.service.ts
 */

import { HiringApplicationStatus } from '@prisma/client';

// Pure rules for moving a hiring application from one status to the next.
// "Pure" means: no database, no Nest. It only looks at its inputs and either
// returns the new status or throws a TransitionError.

export type PipelineAction =
  | 'shortlist'
  | 'requestInterview'
  | 'reject'
  | 'sendOffer'
  | 'withdrawOffer'
  | 'acceptOffer'
  | 'declineOffer'
  | 'withdraw';

// An admin acts as 'recruiter' - the caller passes 'recruiter' for admins.
export type Actor = 'recruiter' | 'candidate';

export type TransitionContext = {
  hasCompletedInterview: boolean;
  hasActiveInterview: boolean;
  postOpen: boolean;
  openingsLeft: number | null; // null = no limit
};

// 'forbidden' becomes HTTP 403 later, 'conflict' becomes HTTP 409.
export class TransitionError extends Error {
  constructor(
    readonly kind: 'forbidden' | 'conflict',
    message: string,
  ) {
    super(message);
    this.name = 'TransitionError';
  }
}

const S = HiringApplicationStatus;

// Words used in the wrong-status sentence. Final statuses read "was already <label>",
// the others read "is <label> right now".
export const STATUS_LABEL: Record<HiringApplicationStatus, string> = {
  APPLIED: 'new',
  REVIEWING: 'on the shortlist',
  INTERVIEWING: 'in the interview stage',
  OFFERED: 'waiting for an answer to an offer',
  HIRED: 'hired',
  REJECTED: 'rejected',
  DECLINED: 'declined',
  WITHDRAWN: 'withdrawn',
};

const ACTIVE: HiringApplicationStatus[] = [
  S.APPLIED,
  S.REVIEWING,
  S.INTERVIEWING,
  S.OFFERED,
];

// An application is "active" while it can still move forward.
export function isActive(status: HiringApplicationStatus): boolean {
  return ACTIVE.includes(status);
}

// The lookup table: who may do the action, from which statuses, and where it leads.
const RULES: Record<
  PipelineAction,
  { actor: Actor; from: HiringApplicationStatus[]; to: HiringApplicationStatus }
> = {
  shortlist: { actor: 'recruiter', from: [S.APPLIED], to: S.REVIEWING },
  requestInterview: {
    actor: 'recruiter',
    from: [S.APPLIED, S.REVIEWING, S.INTERVIEWING],
    to: S.INTERVIEWING,
  },
  reject: {
    actor: 'recruiter',
    from: [S.APPLIED, S.REVIEWING, S.INTERVIEWING],
    to: S.REJECTED,
  },
  sendOffer: { actor: 'recruiter', from: [S.INTERVIEWING], to: S.OFFERED },
  withdrawOffer: { actor: 'recruiter', from: [S.OFFERED], to: S.INTERVIEWING },
  acceptOffer: { actor: 'candidate', from: [S.OFFERED], to: S.HIRED },
  declineOffer: { actor: 'candidate', from: [S.OFFERED], to: S.DECLINED },
  withdraw: { actor: 'candidate', from: ACTIVE, to: S.WITHDRAWN },
};

// Order of checks: actor (403), post open, status, then the extra context rules.
export function nextStatus(
  action: PipelineAction,
  actor: Actor,
  from: HiringApplicationStatus,
  ctx: TransitionContext,
): HiringApplicationStatus {
  const rule = RULES[action];

  if (rule.actor !== actor) {
    throw new TransitionError(
      'forbidden',
      'You are not allowed to do this on this application.',
    );
  }
  if (!ctx.postOpen) {
    throw new TransitionError('conflict', 'This hiring post is closed.');
  }
  if (!rule.from.includes(from)) {
    throw new TransitionError(
      'conflict',
      isActive(from)
        ? `This application is ${STATUS_LABEL[from]} right now.`
        : `This application was already ${STATUS_LABEL[from]}.`,
    );
  }

  if (action === 'requestInterview' && ctx.hasActiveInterview) {
    throw new TransitionError(
      'conflict',
      'This application already has an interview in progress.',
    );
  }
  if (action === 'sendOffer') {
    if (ctx.hasActiveInterview) {
      throw new TransitionError(
        'conflict',
        'Finish the interview in progress before sending an offer.',
      );
    }
    if (!ctx.hasCompletedInterview) {
      throw new TransitionError(
        'conflict',
        'Finish an interview before sending an offer.',
      );
    }
    if (ctx.openingsLeft !== null && ctx.openingsLeft <= 0) {
      throw new TransitionError(
        'conflict',
        'No openings left. Withdraw an offer first.',
      );
    }
  }

  return rule.to;
}

import {
  ContractStatus,
  MilestoneStatus,
  ProposalStatus,
} from '@prisma/client';

// Pure rules for proposals and milestones. "Pure" means: no database, no Nest.
// It only looks at its inputs and either returns a value or throws a RuleError.

export type Side = 'client' | 'freelancer';

// 'forbidden' becomes HTTP 403, 'conflict' becomes HTTP 409, 'invalid' becomes HTTP 400.
export class RuleError extends Error {
  constructor(
    readonly kind: 'forbidden' | 'conflict' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'RuleError';
  }
}

const P = ProposalStatus;
const M = MilestoneStatus;
const C = ContractStatus;

// ---------- Proposal version checks ----------

export type MilestoneDraft = {
  title: string;
  description?: string | null;
  dueDate: Date;
  amount: number;
};

const MAX_MILESTONES = 20;
const MAX_AMENDMENT_CHANGES = 10;

// Checks one version of a proposal (deadline + milestones). Throws 'invalid'.
export function checkVersion(
  v: { deadline: Date; milestones: MilestoneDraft[] },
  now: Date,
): void {
  const list = v.milestones;
  if (list.length < 1 || list.length > MAX_MILESTONES) {
    throw new RuleError('invalid', 'A proposal has 1 to 20 milestones.');
  }
  if (list.some((m) => !Number.isInteger(m.amount) || m.amount < 1)) {
    throw new RuleError('invalid', 'Each milestone is at least 1 credit.');
  }
  if (list[0].dueDate.getTime() <= now.getTime()) {
    throw new RuleError('invalid', 'The first due date must be in the future.');
  }
  for (let i = 1; i < list.length; i++) {
    if (list[i].dueDate.getTime() < list[i - 1].dueDate.getTime()) {
      throw new RuleError('invalid', 'Milestone due dates must be in order.');
    }
  }
  const last = list[list.length - 1].dueDate;
  if (last.getTime() > v.deadline.getTime()) {
    throw new RuleError('invalid', 'A due date cannot be after the deadline.');
  }
}

// Total credits of a version.
export function versionTotal(milestones: { amount: number }[]): number {
  return milestones.reduce((sum, m) => sum + m.amount, 0);
}

// ---------- Proposal actions ----------

export type ProposalAction = 'accept' | 'decline' | 'counter' | 'withdraw';

// Words for the "already closed" sentence.
const PROPOSAL_CLOSED: Record<ProposalStatus, string> = {
  OPEN: 'open',
  ACCEPTED: 'This proposal was already accepted.',
  DECLINED: 'This proposal was already declined.',
  WITHDRAWN: 'This proposal was already withdrawn.',
  EXPIRED: 'This proposal already expired.',
};

// Order of checks: status (409), who (403 for withdraw, 409 for turn), accepted version (409).
export function checkProposalAction(
  action: ProposalAction,
  userId: number,
  p: {
    status: ProposalStatus;
    turnUserId: number | null;
    latestAuthorId: number;
    latestVersion: number;
  },
  acceptVersion?: number,
): void {
  if (p.status !== P.OPEN) {
    throw new RuleError('conflict', PROPOSAL_CLOSED[p.status]);
  }
  if (action === 'withdraw') {
    // Only the person who sent the latest version may take it back.
    if (p.latestAuthorId !== userId) {
      throw new RuleError(
        'forbidden',
        'Only the person who sent the latest version can withdraw it.',
      );
    }
    return;
  }
  if (p.turnUserId !== userId) {
    throw new RuleError('conflict', "It is the other person's turn.");
  }
  // Accept names the version the user read; a newer one means they did not see it.
  if (
    action === 'accept' &&
    acceptVersion !== undefined &&
    acceptVersion !== p.latestVersion
  ) {
    throw new RuleError(
      'conflict',
      'A newer version was sent. Read it before you accept.',
    );
  }
}

// ---------- Milestone actions ----------

export type MilestoneAction = 'fund' | 'submit' | 'requestChanges' | 'approve';

// Statuses where the credits of a milestone are held (kept aside) in the client's wallet.
export const HELD_STATUSES: readonly MilestoneStatus[] = [
  M.FUNDED,
  M.SUBMITTED,
  M.CHANGES_REQUESTED,
];

// The lookup table: who may do the action, from which statuses, and where it leads.
const MILESTONE_RULES: Record<
  MilestoneAction,
  { side: Side; from: MilestoneStatus[]; to: MilestoneStatus }
> = {
  fund: { side: 'client', from: [M.PENDING], to: M.FUNDED },
  submit: {
    side: 'freelancer',
    from: [M.FUNDED, M.CHANGES_REQUESTED],
    to: M.SUBMITTED,
  },
  requestChanges: {
    side: 'client',
    from: [M.SUBMITTED],
    to: M.CHANGES_REQUESTED,
  },
  approve: { side: 'client', from: [M.SUBMITTED], to: M.APPROVED },
};

// Words used in the wrong-status sentence.
const MILESTONE_LABEL: Record<MilestoneStatus, string> = {
  PENDING: 'not funded yet',
  FUNDED: 'funded',
  SUBMITTED: 'submitted',
  CHANGES_REQUESTED: 'waiting for changes',
  APPROVED: 'approved',
  CANCELLED: 'cancelled',
};
const MILESTONE_FINAL: MilestoneStatus[] = [M.APPROVED, M.CANCELLED];

// Order of checks: contract state (409), side (403), milestone status (409), then fund order.
// "position" counts from 1 (milestone 1 is the first).
export function nextMilestoneStatus(
  action: MilestoneAction,
  side: Side,
  m: { status: MilestoneStatus; position: number },
  ctx: {
    contractStatus: ContractStatus;
    previous: { status: MilestoneStatus } | null;
  },
): MilestoneStatus {
  if (ctx.contractStatus === C.ENDED) {
    throw new RuleError('conflict', 'This contract has ended.');
  }
  if (ctx.contractStatus === C.COMPLETED) {
    throw new RuleError('conflict', 'This contract is completed.');
  }
  const rule = MILESTONE_RULES[action];
  if (rule.side !== side) {
    throw new RuleError(
      'forbidden',
      'You are not allowed to do this on this milestone.',
    );
  }
  if (!rule.from.includes(m.status)) {
    if (action === 'fund' && m.status !== M.CANCELLED) {
      throw new RuleError(
        'conflict',
        `Milestone ${m.position} is already funded.`,
      );
    }
    throw new RuleError(
      'conflict',
      MILESTONE_FINAL.includes(m.status)
        ? `Milestone ${m.position} was already ${MILESTONE_LABEL[m.status]}.`
        : `Milestone ${m.position} is ${MILESTONE_LABEL[m.status]} right now.`,
    );
  }
  // Milestones are paid one after another: the one before must be approved first.
  if (
    action === 'fund' &&
    ctx.previous !== null &&
    ctx.previous.status !== M.APPROVED
  ) {
    throw new RuleError(
      'conflict',
      `Fund milestone ${m.position} after milestone ${m.position - 1} is approved.`,
    );
  }
  return rule.to;
}

// 1250 -> "1,250" (fixed locale so the text is the same on every server).
export function fmtCredits(n: number): string {
  return n.toLocaleString('en-US');
}

// ---------- Amendments ----------

// One change of an amendment, with the dates already turned into Date objects.
export type AmendmentChangeParsed =
  | {
      op: 'add';
      title: string;
      description?: string;
      dueDate: Date;
      amount: number;
    }
  | { op: 'move'; milestoneId: number; dueDate: Date }
  | { op: 'amount'; milestoneId: number; amount: number };

// Statuses where a due date may move (an amount may change only on PENDING).
const MOVABLE: MilestoneStatus[] = [M.PENDING, M.FUNDED, M.CHANGES_REQUESTED];

// Checks an amendment against the contract as it is NOW (the same check runs when it is sent and
// again when it is accepted, because the milestones may have moved on). Throws 'invalid' (400) or
// 'conflict' (409). "position" counts from 1.
export function checkAmendment(
  a: { deadline?: Date; changes: AmendmentChangeParsed[] },
  milestones: {
    id: number;
    status: MilestoneStatus;
    position: number;
    dueDate: Date;
  }[],
  contractDeadline: Date,
  now: Date,
): void {
  if (a.changes.length === 0 && !a.deadline) {
    throw new RuleError(
      'invalid',
      'changes must have at least one change, or send a new deadline.',
    );
  }
  if (a.changes.length > MAX_AMENDMENT_CHANGES) {
    throw new RuleError('invalid', 'changes can have up to 10 items.');
  }
  if (a.deadline && a.deadline.getTime() <= now.getTime()) {
    throw new RuleError('invalid', 'The new deadline must be in the future.');
  }

  // The timeline after the changes, in position order.
  const timeline = milestones
    .map((m) => ({
      position: m.position,
      dueDate: m.dueDate,
      status: m.status,
    }))
    .sort((x, y) => x.position - y.position);
  const seen = new Set<string>();
  let nextPosition = milestones.reduce(
    (max, m) => Math.max(max, m.position),
    0,
  );

  for (const change of a.changes) {
    if (change.op === 'add') {
      if (!Number.isInteger(change.amount) || change.amount < 1) {
        throw new RuleError('invalid', 'Each milestone is at least 1 credit.');
      }
      if (change.dueDate.getTime() <= now.getTime()) {
        throw new RuleError('invalid', 'A new due date must be in the future.');
      }
      timeline.push({
        position: ++nextPosition,
        dueDate: change.dueDate,
        status: M.PENDING,
      });
      continue;
    }
    const key = `${change.op}:${change.milestoneId}`;
    if (seen.has(key)) {
      throw new RuleError(
        'invalid',
        `changes names milestone ${change.milestoneId} twice for the same change.`,
      );
    }
    seen.add(key);
    const m = milestones.find((x) => x.id === change.milestoneId);
    if (!m) {
      throw new RuleError(
        'invalid',
        `changes names milestone ${change.milestoneId}, which is not on this contract.`,
      );
    }
    if (!MOVABLE.includes(m.status)) {
      throw new RuleError(
        'conflict',
        `Milestone ${m.position} cannot be changed now.`,
      );
    }
    if (change.op === 'amount') {
      if (m.status !== M.PENDING) {
        throw new RuleError(
          'conflict',
          `The amount of milestone ${m.position} cannot change after it is funded.`,
        );
      }
      if (!Number.isInteger(change.amount) || change.amount < 1) {
        throw new RuleError('invalid', 'Each milestone is at least 1 credit.');
      }
    } else {
      if (change.dueDate.getTime() <= now.getTime()) {
        throw new RuleError('invalid', 'A new due date must be in the future.');
      }
      timeline.find((t) => t.position === m.position)!.dueDate = change.dueDate;
    }
  }

  if (timeline.length > MAX_MILESTONES) {
    throw new RuleError('invalid', 'A contract has up to 20 milestones.');
  }
  const live = timeline.filter((t) => t.status !== M.CANCELLED);
  for (let i = 1; i < live.length; i++) {
    if (live[i].dueDate.getTime() < live[i - 1].dueDate.getTime()) {
      throw new RuleError('invalid', 'Milestone due dates must be in order.');
    }
  }
  const deadline = a.deadline ?? contractDeadline;
  const last = live[live.length - 1];
  if (last && last.dueDate.getTime() > deadline.getTime()) {
    throw new RuleError('invalid', 'A due date cannot be after the deadline.');
  }
}

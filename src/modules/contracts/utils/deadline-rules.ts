/**
 * Pure deadline rules for active contracts in the contracts module.
 * Calculates warning and cutoff times for silent clients, late freelancers, and unfunded milestones and picks the next sweeper action.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/modules/contracts/services/contract-events.service.ts
 *   - src/modules/contracts/services/contract-sweeper.service.ts
 *   - src/tools/demo-activity/build-contracts.ts
 */

import { ContractStatus, Milestone, MilestoneStatus } from '@prisma/client';

// Pure rules for the 3-day deadlines. "Pure" means: no database, no Nest, no clock
// of its own. The sweeper (a job that runs every minute) passes in "now".

export type DeadlineRule = 'CLIENT_SILENT' | 'FREELANCER_LATE' | 'NOT_FUNDED';

export type SweepMilestone = Pick<
  Milestone,
  | 'id'
  | 'position'
  | 'status'
  | 'dueDate'
  | 'fundedAt'
  | 'submittedAt'
  | 'changesRequestedAt'
  | 'approvedAt'
  | 'lateWarnedAt'
  | 'silentWarnedAt'
  | 'unfundedWarnedAt'
>;

export type SweepContract = {
  status: ContractStatus;
  imported: boolean;
  createdAt: Date;
  milestones: SweepMilestone[];
};

// 'warn' = send the day-2 warning once. 'end' = the 3-day window is over.
export type Decision = {
  rule: DeadlineRule;
  milestoneId: number;
  act: 'warn' | 'end';
} | null;

const M = MilestoneStatus;
const MINUTE = 60_000;
// The order the rules are checked in (spec 4.10).
const RULES: DeadlineRule[] = [
  'CLIENT_SILENT',
  'FREELANCER_LATE',
  'NOT_FUNDED',
];

const addMinutes = (d: Date, minutes: number) =>
  new Date(d.getTime() + minutes * MINUTE);

function latest(...dates: (Date | null)[]): Date {
  const real = dates.filter((d): d is Date => d !== null);
  return new Date(Math.max(...real.map((d) => d.getTime())));
}

// When the clock of a rule starts, when the warning is due and when the window ends.
// graceMinutes is the length of the window (4320 = 3 days). The day-2 warning
// comes at two thirds of it.
export function ruleClock(
  rule: DeadlineRule,
  c: SweepContract,
  m: SweepMilestone,
  graceMinutes: number,
): { start: Date; warnAt: Date; endAt: Date } {
  const warnAfter = Math.round((graceMinutes * 2) / 3);
  let start: Date;
  if (rule === 'CLIENT_SILENT') {
    // Starts at the latest submission.
    start = m.submittedAt ?? c.createdAt;
  } else if (rule === 'FREELANCER_LATE') {
    // A freelancer asked for changes (or a milestone funded) after the due date
    // still gets the full window from that moment.
    start = latest(m.dueDate, m.changesRequestedAt, m.fundedAt);
    return { start, warnAt: start, endAt: addMinutes(start, graceMinutes) };
  } else {
    // NOT_FUNDED: from the approval of the previous milestone, or from the
    // contract creation for milestone 1.
    const prev = c.milestones.find((x) => x.position === m.position - 1);
    start = prev?.approvedAt ?? c.createdAt;
  }
  return {
    start,
    warnAt: addMinutes(start, warnAfter),
    endAt: addMinutes(start, graceMinutes),
  };
}

// Which milestone a rule looks at (the first one that fits), or undefined.
function target(
  rule: DeadlineRule,
  c: SweepContract,
  sorted: SweepMilestone[],
): SweepMilestone | undefined {
  if (rule === 'CLIENT_SILENT') {
    return sorted.find((m) => m.status === M.SUBMITTED);
  }
  if (rule === 'FREELANCER_LATE') {
    return sorted.find(
      (m) => m.status === M.FUNDED || m.status === M.CHANGES_REQUESTED,
    );
  }
  // NOT_FUNDED is skipped for imported hires (they have no real funding flow).
  if (c.imported) return undefined;
  return sorted.find((m) => {
    if (m.status !== M.PENDING) return false;
    if (m.position === 1) return true;
    const prev = sorted.find((x) => x.position === m.position - 1);
    return prev?.status === M.APPROVED && prev.approvedAt !== null;
  });
}

function warnedFlag(rule: DeadlineRule, m: SweepMilestone): Date | null {
  if (rule === 'CLIENT_SILENT') return m.silentWarnedAt;
  if (rule === 'FREELANCER_LATE') return m.lateWarnedAt;
  return m.unfundedWarnedAt;
}

// Decides what the sweeper should do for one contract right now. At most one
// decision. Rules are checked in order; an "end" beats a "warn" if both are due.
export function evaluateDeadlines(
  c: SweepContract,
  now: Date,
  graceMinutes: number,
): Decision {
  if (c.status !== ContractStatus.ACTIVE) return null;
  const sorted = [...c.milestones].sort((a, b) => a.position - b.position);

  let warn: Decision = null;
  for (const rule of RULES) {
    const m = target(rule, c, sorted);
    if (!m) continue;
    const { warnAt, endAt } = ruleClock(rule, c, m, graceMinutes);
    if (now >= endAt) return { rule, milestoneId: m.id, act: 'end' };
    const dueReached = rule !== 'FREELANCER_LATE' || now >= m.dueDate;
    if (!warn && dueReached && now >= warnAt && warnedFlag(rule, m) === null) {
      warn = { rule, milestoneId: m.id, act: 'warn' };
    }
  }
  return warn;
}

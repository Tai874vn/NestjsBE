import { ContractStatus as C, MilestoneStatus as M } from '@prisma/client';
import {
  evaluateDeadlines,
  ruleClock,
  SweepContract,
  SweepMilestone,
} from '../deadline-rules';

const GRACE = 4320; // 3 days in minutes
const NOW = new Date('2026-11-24T12:00:00Z');
const MIN = 60_000;
const DAY = 1440; // minutes in a day
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * MIN);

function ms(
  over: Partial<SweepMilestone> & { position: number },
): SweepMilestone {
  return {
    id: over.position,
    status: M.PENDING,
    dueDate: ago(-10 * DAY),
    fundedAt: null,
    submittedAt: null,
    changesRequestedAt: null,
    approvedAt: null,
    lateWarnedAt: null,
    silentWarnedAt: null,
    unfundedWarnedAt: null,
    ...over,
  };
}

function contract(
  milestones: SweepMilestone[],
  over: Partial<SweepContract> = {},
): SweepContract {
  return {
    status: C.ACTIVE,
    imported: false,
    createdAt: ago(30 * DAY),
    milestones,
    ...over,
  };
}

const run = (c: SweepContract, grace = GRACE) =>
  evaluateDeadlines(c, NOW, grace);

describe('evaluateDeadlines', () => {
  describe('CLIENT_SILENT', () => {
    const sub = (minutes: number, extra: Partial<SweepMilestone> = {}) =>
      contract([
        ms({
          position: 1,
          status: M.SUBMITTED,
          submittedAt: ago(minutes),
          ...extra,
        }),
      ]);

    it('does nothing after 1 day', () => {
      expect(run(sub(DAY))).toBeNull();
    });
    it('warns after 2 days', () => {
      expect(run(sub(2 * DAY))).toEqual({
        rule: 'CLIENT_SILENT',
        milestoneId: 1,
        act: 'warn',
      });
    });
    it('does not warn twice', () => {
      expect(run(sub(2 * DAY, { silentWarnedAt: ago(10) }))).toBeNull();
    });
    it('ends after 3 days', () => {
      expect(run(sub(3 * DAY))).toEqual({
        rule: 'CLIENT_SILENT',
        milestoneId: 1,
        act: 'end',
      });
    });
    it('ends even if the warning was never sent (end wins)', () => {
      expect(run(sub(4 * DAY))?.act).toBe('end');
    });
    it('is never FREELANCER_LATE even with a long-past due date', () => {
      expect(run(sub(DAY, { dueDate: ago(30 * DAY) }))).toBeNull();
    });
    it('uses the grace setting (10 minutes: 11 minutes ago ends)', () => {
      expect(run(sub(11), 10)?.act).toBe('end');
    });
  });

  describe('FREELANCER_LATE', () => {
    const funded = (due: number, extra: Partial<SweepMilestone> = {}) =>
      contract([
        ms({
          position: 1,
          status: M.FUNDED,
          fundedAt: ago(20 * DAY),
          dueDate: ago(due),
          ...extra,
        }),
      ]);

    it('does nothing before the due date', () => {
      expect(run(funded(-60))).toBeNull();
    });
    it('warns when due 1 hour ago', () => {
      expect(run(funded(60))).toEqual({
        rule: 'FREELANCER_LATE',
        milestoneId: 1,
        act: 'warn',
      });
    });
    it('does not warn twice', () => {
      expect(run(funded(60, { lateWarnedAt: ago(5) }))).toBeNull();
    });
    it('ends when due 3 days and 1 minute ago', () => {
      expect(run(funded(3 * DAY + 1))?.act).toBe('end');
    });
    it('CHANGES_REQUESTED 1 day ago, due 5 days ago: warn only', () => {
      const c = contract([
        ms({
          position: 1,
          status: M.CHANGES_REQUESTED,
          fundedAt: ago(20 * DAY),
          dueDate: ago(5 * DAY),
          changesRequestedAt: ago(DAY),
        }),
      ]);
      expect(run(c)?.act).toBe('warn');
    });
    it('CHANGES_REQUESTED ends only at request + 3 days', () => {
      const mk = (m: number) =>
        contract([
          ms({
            position: 1,
            status: M.CHANGES_REQUESTED,
            fundedAt: ago(20 * DAY),
            dueDate: ago(9 * DAY),
            changesRequestedAt: ago(m),
            lateWarnedAt: ago(1),
          }),
        ]);
      expect(run(mk(3 * DAY - 1))).toBeNull();
      expect(run(mk(3 * DAY))?.act).toBe('end');
    });
    it('funded today with a due date 5 days ago is not ended', () => {
      const d = run(funded(5 * DAY, { fundedAt: ago(10) }));
      expect(d?.act).toBe('warn');
    });
  });

  describe('NOT_FUNDED', () => {
    const two = (approvedMin: number, over: Partial<SweepContract> = {}) =>
      contract(
        [
          ms({ position: 1, status: M.APPROVED, approvedAt: ago(approvedMin) }),
          ms({ position: 2, status: M.PENDING }),
        ],
        over,
      );

    it('does nothing after 1 day', () => {
      expect(run(two(DAY))).toBeNull();
    });
    it('warns after 2 days', () => {
      expect(run(two(2 * DAY))).toEqual({
        rule: 'NOT_FUNDED',
        milestoneId: 2,
        act: 'warn',
      });
    });
    it('ends after 3 days', () => {
      expect(run(two(3 * DAY))?.act).toBe('end');
    });
    it('is skipped for imported contracts', () => {
      expect(run(two(5 * DAY, { imported: true }))).toBeNull();
    });
    it('milestone 1 PENDING counts from the contract creation', () => {
      const c = contract([ms({ position: 1 })], { createdAt: ago(2 * DAY) });
      expect(run(c)).toEqual({
        rule: 'NOT_FUNDED',
        milestoneId: 1,
        act: 'warn',
      });
    });
    it('ignores a PENDING milestone whose previous one is not approved', () => {
      const c = contract([
        ms({ position: 1, status: M.FUNDED, dueDate: ago(-DAY) }),
        ms({ position: 2 }),
      ]);
      expect(run(c)).toBeNull();
    });
  });

  describe('priority and status', () => {
    it('returns null for a contract that is not ACTIVE', () => {
      const c = contract(
        [ms({ position: 1, status: M.SUBMITTED, submittedAt: ago(9 * DAY) })],
        { status: C.ENDED },
      );
      expect(run(c)).toBeNull();
    });
    it('client silent comes before freelancer late and not funded', () => {
      const c = contract([
        ms({ position: 1, status: M.SUBMITTED, submittedAt: ago(2 * DAY) }),
        ms({
          position: 2,
          status: M.FUNDED,
          fundedAt: ago(9 * DAY),
          dueDate: ago(DAY),
        }),
      ]);
      expect(run(c)?.rule).toBe('CLIENT_SILENT');
    });
    it('an ending beats a warning from a higher rule', () => {
      const c = contract([
        ms({ position: 1, status: M.SUBMITTED, submittedAt: ago(2 * DAY) }),
        ms({
          position: 2,
          status: M.FUNDED,
          fundedAt: ago(9 * DAY),
          dueDate: ago(4 * DAY),
        }),
      ]);
      expect(run(c)).toEqual({
        rule: 'FREELANCER_LATE',
        milestoneId: 2,
        act: 'end',
      });
    });
  });
});

describe('ruleClock', () => {
  it('gives start, warnAt and endAt for client silent', () => {
    const m = ms({ position: 1, status: M.SUBMITTED, submittedAt: ago(100) });
    const r = ruleClock('CLIENT_SILENT', contract([m]), m, GRACE);
    expect(r.start).toEqual(ago(100));
    expect(r.warnAt.getTime() - r.start.getTime()).toBe(2880 * MIN);
    expect(r.endAt.getTime() - r.start.getTime()).toBe(4320 * MIN);
  });
  it('freelancer late takes the latest of due, request and funding', () => {
    const m = ms({
      position: 1,
      status: M.CHANGES_REQUESTED,
      dueDate: ago(5 * DAY),
      changesRequestedAt: ago(DAY),
      fundedAt: ago(9 * DAY),
    });
    const r = ruleClock('FREELANCER_LATE', contract([m]), m, GRACE);
    expect(r.start).toEqual(ago(DAY));
    expect(r.warnAt).toEqual(r.start);
  });
});

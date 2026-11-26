import {
  ContractStatus as C,
  MilestoneStatus as M,
  ProposalStatus as P,
} from '@prisma/client';
import {
  checkAmendment,
  checkProposalAction,
  checkVersion,
  fmtCredits,
  HELD_STATUSES,
  MilestoneAction,
  MilestoneDraft,
  nextMilestoneStatus,
  RuleError,
  Side,
  versionTotal,
} from '../contract-rules';

const NOW = new Date('2026-01-01T00:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const ms = (over: Partial<MilestoneDraft> = {}): MilestoneDraft => ({
  title: 'Part',
  dueDate: day(5),
  amount: 100,
  ...over,
});

function outcome(fn: () => unknown): { kind?: string; message?: string } {
  try {
    fn();
  } catch (e) {
    if (e instanceof RuleError) return { kind: e.kind, message: e.message };
    throw e;
  }
  return {};
}

describe('checkVersion', () => {
  const ok = {
    deadline: day(30),
    milestones: [ms({ dueDate: day(5) }), ms({ dueDate: day(10) })],
  };

  it('accepts a good version', () => {
    expect(() => checkVersion(ok, NOW)).not.toThrow();
  });

  const bad: [string, Parameters<typeof checkVersion>[0], string][] = [
    [
      'dates out of order',
      {
        deadline: day(30),
        milestones: [ms({ dueDate: day(10) }), ms({ dueDate: day(5) })],
      },
      'Milestone due dates must be in order.',
    ],
    [
      'due date after deadline',
      {
        deadline: day(8),
        milestones: [ms({ dueDate: day(5) }), ms({ dueDate: day(10) })],
      },
      'A due date cannot be after the deadline.',
    ],
    [
      'first due date not in the future',
      { deadline: day(30), milestones: [ms({ dueDate: NOW })] },
      'The first due date must be in the future.',
    ],
    [
      'no milestones',
      { deadline: day(30), milestones: [] },
      'A proposal has 1 to 20 milestones.',
    ],
    [
      '21 milestones',
      {
        deadline: day(60),
        milestones: Array.from({ length: 21 }, (_, i) =>
          ms({ dueDate: day(i + 1) }),
        ),
      },
      'A proposal has 1 to 20 milestones.',
    ],
    [
      'amount 0',
      { deadline: day(30), milestones: [ms({ amount: 0 })] },
      'Each milestone is at least 1 credit.',
    ],
  ];
  it.each(bad)('rejects %s', (_n, v, message) => {
    expect(outcome(() => checkVersion(v, NOW))).toEqual({
      kind: 'invalid',
      message,
    });
  });

  it('allows exactly 20 milestones and a due date equal to the deadline', () => {
    const milestones = Array.from({ length: 20 }, (_, i) =>
      ms({ dueDate: day(i + 1) }),
    );
    expect(() =>
      checkVersion({ deadline: day(20), milestones }, NOW),
    ).not.toThrow();
  });
});

describe('versionTotal and fmtCredits', () => {
  it('adds amounts', () => {
    expect(versionTotal([{ amount: 100 }, { amount: 250 }])).toBe(350);
    expect(versionTotal([])).toBe(0);
  });
  it('formats with thousand commas', () => {
    expect(fmtCredits(1250)).toBe('1,250');
    expect(fmtCredits(5)).toBe('5');
    expect(fmtCredits(1000000)).toBe('1,000,000');
  });
});

describe('checkProposalAction', () => {
  const open = {
    status: P.OPEN,
    turnUserId: 2 as number | null,
    latestAuthorId: 1,
    latestVersion: 3,
  };

  it.each(['accept', 'decline', 'counter'] as const)(
    '%s by the turn user is ok',
    (a) => {
      expect(() => checkProposalAction(a, 2, open)).not.toThrow();
    },
  );
  it.each(['accept', 'decline', 'counter'] as const)(
    '%s by the other side is a conflict',
    (a) => {
      expect(outcome(() => checkProposalAction(a, 1, open))).toEqual({
        kind: 'conflict',
        message: "It is the other person's turn.",
      });
    },
  );
  it('withdraw by the latest author is ok, by the other is forbidden', () => {
    expect(() => checkProposalAction('withdraw', 1, open)).not.toThrow();
    expect(outcome(() => checkProposalAction('withdraw', 2, open)).kind).toBe(
      'forbidden',
    );
  });
  it.each(['accept', 'decline', 'counter', 'withdraw'] as const)(
    '%s on DECLINED is a conflict',
    (a) => {
      expect(
        outcome(() =>
          checkProposalAction(a, 2, {
            ...open,
            status: P.DECLINED,
            turnUserId: null,
          }),
        ),
      ).toEqual({
        kind: 'conflict',
        message: 'This proposal was already declined.',
      });
    },
  );
  it('names other closed states', () => {
    const closed = (status: P) =>
      outcome(() =>
        checkProposalAction('accept', 2, { ...open, status, turnUserId: null }),
      ).message;
    expect(closed(P.ACCEPTED)).toBe('This proposal was already accepted.');
    expect(closed(P.WITHDRAWN)).toBe('This proposal was already withdrawn.');
    expect(closed(P.EXPIRED)).toBe('This proposal already expired.');
  });
  it('accept with an old version is a conflict', () => {
    expect(outcome(() => checkProposalAction('accept', 2, open, 2))).toEqual({
      kind: 'conflict',
      message: 'A newer version was sent. Read it before you accept.',
    });
    expect(() => checkProposalAction('accept', 2, open, 3)).not.toThrow();
  });
});

describe('nextMilestoneStatus', () => {
  const ctx = (
    over: Partial<{ contractStatus: C; previous: { status: M } | null }> = {},
  ) => ({
    contractStatus: C.ACTIVE,
    previous: null,
    ...over,
  });
  const run = (
    a: MilestoneAction,
    side: Side,
    status: M,
    position = 1,
    c = ctx(),
  ) => nextMilestoneStatus(a, side, { status, position }, c);

  it.each([
    ['fund', 'client', M.PENDING, M.FUNDED],
    ['submit', 'freelancer', M.FUNDED, M.SUBMITTED],
    ['submit', 'freelancer', M.CHANGES_REQUESTED, M.SUBMITTED],
    ['requestChanges', 'client', M.SUBMITTED, M.CHANGES_REQUESTED],
    ['approve', 'client', M.SUBMITTED, M.APPROVED],
  ] as [MilestoneAction, Side, M, M][])(
    '%s by %s from %s gives %s',
    (a, side, from, to) => {
      expect(run(a, side, from)).toBe(to);
    },
  );

  it('fund is allowed when the previous milestone is approved', () => {
    expect(
      run('fund', 'client', M.PENDING, 2, ctx({ previous: { status: M.APPROVED } })),
    ).toBe(M.FUNDED);
  });
  it('fund is refused while the previous milestone is not approved', () => {
    expect(
      outcome(() =>
        run('fund', 'client', M.PENDING, 2, ctx({ previous: { status: M.FUNDED } })),
      ),
    ).toEqual({
      kind: 'conflict',
      message: 'Fund milestone 2 after milestone 1 is approved.',
    });
  });
  it('fund on a FUNDED milestone is a conflict', () => {
    expect(outcome(() => run('fund', 'client', M.FUNDED))).toEqual({
      kind: 'conflict',
      message: 'Milestone 1 is already funded.',
    });
  });
  it('wrong side is forbidden', () => {
    expect(outcome(() => run('submit', 'client', M.FUNDED)).kind).toBe('forbidden');
    expect(outcome(() => run('approve', 'freelancer', M.SUBMITTED)).kind).toBe(
      'forbidden',
    );
    expect(outcome(() => run('fund', 'freelancer', M.PENDING)).kind).toBe('forbidden');
  });
  it('wrong status is a conflict naming the state', () => {
    expect(outcome(() => run('approve', 'client', M.FUNDED))).toEqual({
      kind: 'conflict',
      message: 'Milestone 1 is funded right now.',
    });
    expect(outcome(() => run('submit', 'freelancer', M.APPROVED)).message).toBe(
      'Milestone 1 was already approved.',
    );
  });
  it('an ended or completed contract refuses everything', () => {
    expect(
      outcome(() =>
        run('fund', 'client', M.PENDING, 1, ctx({ contractStatus: C.ENDED })),
      ),
    ).toEqual({ kind: 'conflict', message: 'This contract has ended.' });
    expect(
      outcome(() =>
        run('approve', 'client', M.SUBMITTED, 1, ctx({ contractStatus: C.COMPLETED })),
      ),
    ).toEqual({ kind: 'conflict', message: 'This contract is completed.' });
  });
  it('HELD_STATUSES lists the statuses that hold credits', () => {
    expect([...HELD_STATUSES].sort()).toEqual(
      [M.CHANGES_REQUESTED, M.FUNDED, M.SUBMITTED].sort(),
    );
  });
});

describe('checkAmendment', () => {
  const ms3 = [
    { id: 1, position: 1, status: M.APPROVED, dueDate: day(-2) },
    { id: 2, position: 2, status: M.FUNDED, dueDate: day(5) },
    { id: 3, position: 3, status: M.PENDING, dueDate: day(10) },
  ];
  const deadline = day(20);
  const run = (a: Parameters<typeof checkAmendment>[0]) =>
    outcome(() => checkAmendment(a, ms3, deadline, NOW));

  it('no changes and no deadline is 400', () => {
    expect(run({ changes: [] })).toMatchObject({ kind: 'invalid' });
  });

  it('a new deadline alone is fine', () => {
    expect(run({ deadline: day(30), changes: [] })).toEqual({});
  });

  it('moves a FUNDED due date later and changes a PENDING amount', () => {
    expect(
      run({
        changes: [
          { op: 'move', milestoneId: 2, dueDate: day(8) },
          { op: 'amount', milestoneId: 3, amount: 50 },
        ],
      }),
    ).toEqual({});
  });

  it('an amount on a FUNDED milestone is 409', () => {
    expect(
      run({ changes: [{ op: 'amount', milestoneId: 2, amount: 50 }] }),
    ).toMatchObject({ kind: 'conflict' });
  });

  it.each([M.SUBMITTED, M.APPROVED, M.CANCELLED])(
    '%s cannot be changed (409 with the exact sentence)',
    (status) => {
      const list = [{ id: 7, position: 4, status, dueDate: day(6) }];
      expect(
        outcome(() =>
          checkAmendment(
            { changes: [{ op: 'move', milestoneId: 7, dueDate: day(7) }] },
            list,
            deadline,
            NOW,
          ),
        ),
      ).toEqual({
        kind: 'conflict',
        message: 'Milestone 4 cannot be changed now.',
      });
    },
  );

  it('an unknown milestone is 400', () => {
    expect(
      run({ changes: [{ op: 'move', milestoneId: 99, dueDate: day(8) }] }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('a due date in the past, out of order, or after the deadline is 400', () => {
    expect(
      run({ changes: [{ op: 'move', milestoneId: 2, dueDate: day(-1) }] }),
    ).toMatchObject({ kind: 'invalid' });
    expect(
      run({ changes: [{ op: 'move', milestoneId: 2, dueDate: day(12) }] }),
    ).toMatchObject({
      kind: 'invalid',
      message: 'Milestone due dates must be in order.',
    });
    expect(
      run({ changes: [{ op: 'move', milestoneId: 3, dueDate: day(25) }] }),
    ).toMatchObject({
      kind: 'invalid',
      message: 'A due date cannot be after the deadline.',
    });
  });

  it('a later due date passes against the NEW deadline', () => {
    expect(
      run({
        deadline: day(40),
        changes: [{ op: 'move', milestoneId: 3, dueDate: day(25) }],
      }),
    ).toEqual({});
  });

  it('a deadline before the last due date is 400', () => {
    expect(run({ deadline: day(9), changes: [] })).toMatchObject({
      kind: 'invalid',
    });
  });

  it('add checks amount, order and the 20-milestone limit', () => {
    const add = (dueDate: Date, amount = 10) =>
      run({ changes: [{ op: 'add', title: 'New', dueDate, amount }] });
    expect(add(day(12))).toEqual({});
    expect(add(day(12), 0)).toMatchObject({ kind: 'invalid' });
    expect(add(day(9))).toMatchObject({ kind: 'invalid' });
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      position: i + 1,
      status: M.PENDING,
      dueDate: day(i + 1),
    }));
    expect(
      outcome(() =>
        checkAmendment(
          { changes: [{ op: 'add', title: 'x', dueDate: day(21), amount: 5 }] },
          many,
          day(30),
          NOW,
        ),
      ),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('the same change twice on one milestone is 400', () => {
    expect(
      run({
        changes: [
          { op: 'move', milestoneId: 2, dueDate: day(6) },
          { op: 'move', milestoneId: 2, dueDate: day(7) },
        ],
      }),
    ).toMatchObject({ kind: 'invalid' });
  });
});

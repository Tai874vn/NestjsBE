import { HiringApplicationStatus as S } from '@prisma/client';
import {
  Actor,
  isActive,
  nextStatus,
  PipelineAction,
  STATUS_LABEL,
  TransitionContext,
  TransitionError,
} from './application-transitions';

// A normal situation: post open, one finished interview, none running, room left.
const ctx = (over: Partial<TransitionContext> = {}): TransitionContext => ({
  hasCompletedInterview: true,
  hasActiveInterview: false,
  postOpen: true,
  openingsLeft: 1,
  ...over,
});

const ALL = Object.values(S) as S[];

// Every row of the "Who may do what" table: action, actor, allowed statuses, result.
const TABLE: [PipelineAction, Actor, S[], S][] = [
  ['shortlist', 'recruiter', [S.APPLIED], S.REVIEWING],
  [
    'requestInterview',
    'recruiter',
    [S.APPLIED, S.REVIEWING, S.INTERVIEWING],
    S.INTERVIEWING,
  ],
  ['reject', 'recruiter', [S.APPLIED, S.REVIEWING, S.INTERVIEWING], S.REJECTED],
  ['sendOffer', 'recruiter', [S.INTERVIEWING], S.OFFERED],
  ['withdrawOffer', 'recruiter', [S.OFFERED], S.INTERVIEWING],
  ['acceptOffer', 'candidate', [S.OFFERED], S.HIRED],
  ['declineOffer', 'candidate', [S.OFFERED], S.DECLINED],
  [
    'withdraw',
    'candidate',
    [S.APPLIED, S.REVIEWING, S.INTERVIEWING, S.OFFERED],
    S.WITHDRAWN,
  ],
];

const thrown = (fn: () => unknown): TransitionError => {
  try {
    fn();
  } catch (e) {
    return e as TransitionError;
  }
  throw new Error('expected a TransitionError');
};

describe('nextStatus', () => {
  describe.each(TABLE)('%s by %s', (action, actor, allowed, to) => {
    it.each(allowed)('moves %s to the result', (from) => {
      expect(nextStatus(action, actor, from, ctx())).toBe(to);
    });

    it.each(ALL.filter((s) => !allowed.includes(s)))(
      'is a conflict from %s',
      (from) => {
        const err = thrown(() => nextStatus(action, actor, from, ctx()));
        expect(err).toBeInstanceOf(TransitionError);
        expect(err.kind).toBe('conflict');
        expect(err.message.length).toBeGreaterThan(0);
      },
    );

    it('is forbidden for the other actor', () => {
      const other: Actor = actor === 'recruiter' ? 'candidate' : 'recruiter';
      const err = thrown(() => nextStatus(action, other, allowed[0], ctx()));
      expect(err.kind).toBe('forbidden');
    });

    it('is a conflict when the post is closed', () => {
      const err = thrown(() =>
        nextStatus(action, actor, allowed[0], ctx({ postOpen: false })),
      );
      expect(err.kind).toBe('conflict');
      expect(err.message).toBe('This hiring post is closed.');
    });
  });

  it('checks the actor before the post being open', () => {
    const err = thrown(() =>
      nextStatus('acceptOffer', 'recruiter', S.OFFERED, ctx({ postOpen: false })),
    );
    expect(err.kind).toBe('forbidden');
  });

  describe('sendOffer rules', () => {
    it('needs a completed interview', () => {
      const err = thrown(() =>
        nextStatus(
          'sendOffer',
          'recruiter',
          S.INTERVIEWING,
          ctx({ hasCompletedInterview: false }),
        ),
      );
      expect(err.kind).toBe('conflict');
      expect(err.message).toBe('Finish an interview before sending an offer.');
    });

    it('is a conflict while an interview is active', () => {
      const err = thrown(() =>
        nextStatus(
          'sendOffer',
          'recruiter',
          S.INTERVIEWING,
          ctx({ hasActiveInterview: true }),
        ),
      );
      expect(err.kind).toBe('conflict');
    });

    it('is a conflict when no openings are left', () => {
      const err = thrown(() =>
        nextStatus('sendOffer', 'recruiter', S.INTERVIEWING, ctx({ openingsLeft: 0 })),
      );
      expect(err.kind).toBe('conflict');
      expect(err.message).toBe('No openings left. Withdraw an offer first.');
    });

    it('works with no opening limit (null)', () => {
      expect(
        nextStatus('sendOffer', 'recruiter', S.INTERVIEWING, ctx({ openingsLeft: null })),
      ).toBe(S.OFFERED);
    });
  });

  describe('requestInterview rules', () => {
    it('is a conflict from INTERVIEWING while an interview is active', () => {
      const err = thrown(() =>
        nextStatus(
          'requestInterview',
          'recruiter',
          S.INTERVIEWING,
          ctx({ hasActiveInterview: true }),
        ),
      );
      expect(err.kind).toBe('conflict');
      expect(err.message).toBe('This application already has an interview in progress.');
    });
  });

  it('says what the status is when withdrawing from HIRED', () => {
    const err = thrown(() => nextStatus('withdraw', 'candidate', S.HIRED, ctx()));
    expect(err.kind).toBe('conflict');
    expect(err.message).toBe('This application was already hired.');
  });

  it('says what the status is when withdrawing twice', () => {
    const err = thrown(() => nextStatus('withdraw', 'candidate', S.WITHDRAWN, ctx()));
    expect(err.message).toBe('This application was already withdrawn.');
  });
});

describe('isActive', () => {
  it.each([S.APPLIED, S.REVIEWING, S.INTERVIEWING, S.OFFERED])('%s is active', (s) => {
    expect(isActive(s)).toBe(true);
  });
  it.each([S.HIRED, S.REJECTED, S.DECLINED, S.WITHDRAWN])('%s is not active', (s) => {
    expect(isActive(s)).toBe(false);
  });
});

describe('STATUS_LABEL', () => {
  it('has a label for every status', () => {
    for (const s of ALL) expect(STATUS_LABEL[s]).toEqual(expect.any(String));
  });
});

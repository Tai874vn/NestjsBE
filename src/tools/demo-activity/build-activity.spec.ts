import { checkAmendment } from '../../modules/contracts/contract-rules';
import { evaluateDeadlines } from '../../modules/contracts/deadline-rules';
import { priceSplit } from './build-contracts';
import {
  applicationFit,
  buildActivity,
  occupationFit,
  type ActivityInput,
  type Person,
} from './build-activity';

const related = new Map([
  ['2512.3', new Map([['2511.8', 0.34]])],
  ['2511.8', new Map([['2512.3', 0.34]])],
]);
const person = (id: number, extra: Partial<Person> = {}): Person => ({
  id,
  name: `Person${id} Test`,
  kind: 'candidate',
  occupation: '2512.3',
  level: 'Mid',
  years: 4,
  skills: ['TypeScript', 'PostgreSQL'],
  location: 'Hanoi',
  discoverable: true,
  company: null,
  ...extra,
});
const now = new Date('2026-11-19T00:00:00Z');

function input(): ActivityInput {
  return {
    people: [
      person(1),
      person(2, { level: 'Senior', years: 8 }),
      person(3, { occupation: '2511.8' }),
      person(4, { occupation: '2221.1', skills: ['Nursing'] }),
      person(5, { level: 'Junior', years: 0.5 }),
      person(100, { kind: 'recruiter', occupation: null, level: null, years: 0, company: 'Acme' }),
    ],
    hiringPosts: [
      { id: 10, recruiterId: 100, title: 'Software Developer', occupationCode: '2512.3', level: 'Mid', yearsRequired: 3,
        skills: ['TypeScript'], location: 'Hanoi', employmentType: 'Full-time' },
    ],
    services: [{ id: 50, creatorId: 2, title: 'Billing API', summary: 'Billing API, built with TypeScript.',
      description: 'Billing API. Result: cut errors by half.' }],
    related,
    occupationTitle: (code) => ({ '2512.3': 'software developer', '2511.8': 'ICT business analyst' })[code] ?? code,
    now,
  };
}

describe('occupationFit', () => {
  it('is 1 for the same occupation, the ESCO overlap for a related one, 0 otherwise', () => {
    expect(occupationFit('2512.3', '2512.3', related)).toBe(1);
    expect(occupationFit('2511.8', '2512.3', related)).toBe(0.34);
    expect(occupationFit('2512.3', '2221.1', related)).toBe(0);
    expect(occupationFit('2512.3', '2512.9', related)).toBe(0.3);
  });
});

describe('applicationFit', () => {
  it('drops 0.3 per level step and 0.2 when clearly short of years', () => {
    const post = input().hiringPosts[0];
    expect(applicationFit(person(1), post, related)).toBe(1);
    expect(applicationFit(person(2, { level: 'Senior' }), post, related)).toBeCloseTo(0.7);
    expect(applicationFit(person(5, { level: 'Junior', years: 0.5 }), post, related)).toBeCloseTo(0.5);
    expect(applicationFit(person(4, { occupation: '2221.1' }), post, related)).toBe(0);
  });
});

describe('buildActivity', () => {
  const activity = buildActivity(input());

  it('is the same for the same seed', () => {
    expect(JSON.stringify(buildActivity(input()))).toBe(JSON.stringify(activity));
  });

  it('only lets people in a fitting occupation apply, once each', () => {
    const applicants = activity.applications.map((application) => application.applicantId);
    expect(applicants).not.toContain(4);
    expect(new Set(applicants).size).toBe(applicants.length);
    for (const application of activity.applications) {
      expect(application.coverLetter.length).toBeGreaterThan(40);
      expect(application.updatedAt.getTime()).toBeGreaterThanOrEqual(application.createdAt.getTime());
    }
  });

  it('hires at most one applicant per post', () => {
    expect(activity.applications.filter((application) => application.status === 'HIRED').length).toBeLessThanOrEqual(1);
  });

  it('keeps every date in the past and every connection between two different people', () => {
    const dates = [
      ...activity.applications.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...activity.connections.flatMap((item) => [item.createdAt, item.updatedAt]),
      ...activity.feedPosts.flatMap((post) => [post.createdAt, ...post.likes.map((like) => like.createdAt), ...post.comments.map((comment) => comment.createdAt)]),
      ...activity.chats.flatMap((chat) => chat.messages.map((message) => message.createdAt)),
    ];
    for (const date of dates) expect(date.getTime()).toBeLessThanOrEqual(now.getTime());
    for (const connection of activity.connections) expect(connection.requesterId).not.toBe(connection.recipientId);
  });

  it('never lets anyone like or comment as a stranger to the author, or review their own service', () => {
    for (const post of activity.feedPosts) {
      expect(post.likes.map((like) => like.userId)).not.toContain(post.authorId);
      for (const comment of post.comments) {
        if (comment.replyTo !== undefined) expect(comment.authorId).toBe(post.authorId);
      }
    }
    for (const proposal of activity.proposals) {
      expect(proposal.clientId).not.toBe(proposal.freelancerId);
      expect(proposal.freelancerId).toBe(2);
    }
    for (const contract of activity.contracts) expect(contract.clientId).not.toBe(2);
  });

  it('has one chat room per pair, and messages only from its two members', () => {
    const keys = activity.chats.map((chat) => [...chat.members].sort().join(':'));
    expect(new Set(keys).size).toBe(keys.length);
    for (const chat of activity.chats) {
      for (const message of chat.messages) expect(chat.members).toContain(message.senderId);
    }
  });
});

// A bigger site, so every step of the pipeline shows up: 60 candidates, 14 posts with one recruiter each.
function bigInput(): ActivityInput {
  const base = input();
  const levels = ['Junior', 'Mid', 'Senior'] as const;
  return {
    ...base,
    people: [
      ...Array.from({ length: 60 }, (_, index) =>
        person(index + 1, { years: 2 + (index % 7), level: levels[index % 3] }),
      ),
      ...Array.from({ length: 14 }, (_, index) =>
        person(100 + index, { kind: 'recruiter', occupation: null, level: null, years: 0, company: `Company${index}` }),
      ),
    ],
    hiringPosts: Array.from({ length: 14 }, (_, index) => ({
      id: 10 + index,
      recruiterId: 100 + index,
      title: `Software Developer ${index}`,
      occupationCode: '2512.3',
      level: levels[index % 3],
      yearsRequired: 3,
      skills: ['TypeScript'],
      location: 'Hanoi',
      employmentType: 'Full-time',
    })),
    // Services from 20 of the candidates, so the recruiters have work to buy.
    services: Array.from({ length: 20 }, (_, index) => ({
      id: 200 + index,
      creatorId: index * 3 + 1,
      title: `Service ${index}`,
      summary: `Service ${index}, built with TypeScript.`,
      description: `Service ${index}. Result: shipped on time.`,
    })),
  };
}

describe('buildActivity hiring pipeline', () => {
  const big = buildActivity(bigInput());
  const DAYS = 86_400_000;
  const statuses = (status: string) => big.applications.filter((item) => item.status === status);
  const active = ['PROPOSED', 'RESCHEDULE_REQUESTED', 'SCHEDULED'];

  it('shows every step of the pipeline', () => {
    expect(statuses('HIRED').length).toBeGreaterThan(0);
    expect(statuses('OFFERED').length).toBeLessThanOrEqual(5);
    expect(statuses('OFFERED').length).toBeGreaterThan(0);
    expect(statuses('INTERVIEWING').length).toBeGreaterThan(0);
    expect(statuses('REVIEWING').length).toBeGreaterThan(0);
    expect(statuses('ACCEPTED').length).toBe(0);
  });

  it('gives every HIRED or OFFERED application a COMPLETED online interview and offer fields', () => {
    for (const application of [...statuses('HIRED'), ...statuses('OFFERED')]) {
      const done = application.interviews.filter((item) => item.status === 'COMPLETED');
      expect(done.length).toBeGreaterThanOrEqual(1);
      expect(done[0].mode).toBe('ONLINE');
      expect(done[0].round).toBe(1);
      expect(application.offerNote).toBeTruthy();
      expect(application.offeredAt).not.toBeNull();
      expect(application.decidedAt === null).toBe(application.status === 'OFFERED');
    }
  });

  it('gives ONLINE interviews no location: the call runs inside the app, not on an outside link', () => {
    for (const { interviews } of big.applications) {
      for (const interview of interviews.filter((item) => item.mode === 'ONLINE')) {
        expect(interview.location).toBeNull();
      }
    }
  });

  it('has at most one active interview per application, and one for each INTERVIEWING', () => {
    for (const application of big.applications) {
      const open = application.interviews.filter((item) => active.includes(item.status));
      expect(open.length).toBe(application.status === 'INTERVIEWING' ? 1 : 0);
      expect(application.interviews.map((item) => item.round)).toEqual(
        application.interviews.map((_, index) => index + 1),
      );
    }
  });

  it('puts interview times in the future only for PROPOSED and SCHEDULED, 1 to 5 days ahead', () => {
    for (const { interviews } of big.applications) {
      for (const interview of interviews) {
        const times = [...interview.proposedTimes, ...(interview.scheduledAt ? [interview.scheduledAt] : [])];
        for (const time of times) {
          if (interview.status === 'COMPLETED') {
            expect(time.getTime()).toBeLessThanOrEqual(now.getTime() - 3 * DAYS);
            expect(time.getTime()).toBeGreaterThanOrEqual(now.getTime() - 11 * DAYS);
          } else {
            expect(time.getTime()).toBeGreaterThan(now.getTime());
            expect(time.getTime()).toBeLessThanOrEqual(now.getTime() + 6 * DAYS);
          }
        }
        if (interview.status === 'PROPOSED') expect(interview.proposedTimes).toHaveLength(3);
        if (interview.status === 'SCHEDULED') expect(interview.scheduledAt).not.toBeNull();
        if (interview.status === 'COMPLETED') expect(interview.completedAt).not.toBeNull();
      }
    }
  });

  it('keeps hired and offered people within the openings of their post', () => {
    for (const post of bigInput().hiringPosts) {
      const mine = big.applications.filter((item) => item.hiringPostId === post.id);
      const taken = mine.filter((item) => item.status === 'HIRED' || item.status === 'OFFERED');
      expect(taken.length).toBeLessThanOrEqual(big.openings.get(post.id)!);
      expect(big.openings.get(post.id)).toBe(mine.some((item) => item.status === 'HIRED') ? 2 : 1);
    }
  });

  it('writes events in time order, all in the past, ending with the step that matches the status', () => {
    const last: Record<string, string> = {
      HIRED: 'hired',
      OFFERED: 'offer_sent',
      REJECTED: 'rejected',
      WITHDRAWN: 'withdrawn',
    };
    for (const application of big.applications) {
      const { events } = application;
      expect(events[0].type).toBe('applied');
      for (let index = 1; index < events.length; index += 1) {
        expect(events[index].createdAt.getTime()).toBeGreaterThanOrEqual(events[index - 1].createdAt.getTime());
      }
      for (const event of events) expect(event.createdAt.getTime()).toBeLessThanOrEqual(now.getTime());
      if (last[application.status]) expect(events.at(-1)!.type).toBe(last[application.status]);
      expect(application.updatedAt.getTime()).toBeGreaterThanOrEqual(events.at(-1)!.createdAt.getTime());
      expect(events.filter((event) => event.type === 'interview_requested').length).toBe(application.interviews.length);
    }
  });

  it('keeps every application date in the past and after the application was sent', () => {
    for (const application of big.applications) {
      for (const date of [application.updatedAt, application.offeredAt, application.decidedAt]) {
        if (date) expect(date.getTime()).toBeLessThanOrEqual(now.getTime());
      }
      expect(application.updatedAt.getTime()).toBeGreaterThanOrEqual(application.createdAt.getTime());
    }
  });

  it('adds one notice for the latest step, and chat lines that match the interview and offer texts', () => {
    for (const application of big.applications) expect(application.notices.length).toBe(1);
    const texts = big.chats.flatMap((chat) => chat.messages.map((message) => message.content));
    expect(texts.some((text) => /^Interview request for .+: .+ \(online, 45 min\) \(Vietnam time\)$/.test(text))).toBe(true);
    expect(texts.some((text) => text.startsWith('Offer for '))).toBe(true);
    for (const chat of big.chats) {
      const times = chat.messages.map((message) => message.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(chat.createdAt.getTime()).toBeLessThanOrEqual(times[0]);
    }
  });
});

describe('buildActivity contracts and wallets', () => {
  const DAYS = 86_400_000;
  const HELD = ['FUNDED', 'SUBMITTED', 'CHANGES_REQUESTED'];
  const WARNING_SCENARIOS = ['active-late-warned', 'active-silent-warned', 'active-unfunded-warned'];
  // The default 3-day window and a demo setting of 10 minutes, each with a few seeds.
  const runs = [4320, 10].flatMap((graceMinutes) =>
    [undefined, 7, 8, 9].map((seed) => ({
      graceMinutes,
      big: buildActivity({ ...bigInput(), graceMinutes, seed }),
    })),
  );
  const { big } = runs[0];
  type ContractFact = (typeof big.contracts)[number];
  const current = (contract: ContractFact) =>
    contract.milestones.find((m) => m.status !== 'APPROVED' && m.status !== 'CANCELLED');

  it('shows proposals in every state, with the turn on each side and some with 2-3 versions', () => {
    const open = big.proposals.filter((p) => p.status === 'OPEN');
    expect(open.some((p) => p.turnUserId === p.freelancerId)).toBe(true);
    expect(open.some((p) => p.turnUserId === p.clientId)).toBe(true);
    expect(open.some((p) => p.versions.length === 2)).toBe(true);
    expect(open.some((p) => p.versions.length === 3)).toBe(true);
    for (const status of ['DECLINED', 'WITHDRAWN', 'EXPIRED', 'ACCEPTED']) {
      expect(big.proposals.some((p) => p.status === status)).toBe(true);
    }
    for (const p of big.proposals) {
      const latest = p.versions.at(-1)!;
      expect(p.latestVersion).toBe(p.versions.length);
      expect(p.versions.map((v) => v.number)).toEqual(p.versions.map((_, i) => i + 1));
      expect(p.expiresAt.getTime()).toBe(latest.createdAt.getTime() + 7 * DAYS);
      if (p.status === 'OPEN') {
        // The turn is with the side that did not send the latest version; it has not expired.
        expect(p.turnUserId).not.toBe(latest.authorId);
        expect(p.expiresAt.getTime()).toBeGreaterThan(now.getTime());
        expect(latest.milestones[0].dueDate.getTime()).toBeGreaterThan(now.getTime());
        expect(p.decidedAt).toBeNull();
      } else {
        expect(p.turnUserId).toBeNull();
        expect(p.decidedAt).not.toBeNull();
        expect(p.updatedAt.getTime()).toBe(p.decidedAt!.getTime());
      }
      if (p.status === 'EXPIRED') expect(p.decidedAt!.getTime()).toBeGreaterThanOrEqual(p.expiresAt.getTime());
      expect(p.contract !== null).toBe(p.status === 'ACCEPTED');
    }
  });

  it('keeps at most one OPEN proposal per client per service', () => {
    const keys = big.proposals.filter((p) => p.status === 'OPEN').map((p) => `${p.jobId}:${p.clientId}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every version milestones in order, inside the deadline, with the total as their sum', () => {
    for (const p of big.proposals) {
      for (const v of p.versions) {
        expect(v.total).toBe(v.milestones.reduce((sum, m) => sum + m.amount, 0));
        for (const [i, m] of v.milestones.entries()) {
          expect(m.amount).toBeGreaterThanOrEqual(1);
          expect(Number.isInteger(m.amount)).toBe(true);
          expect(m.dueDate.getTime()).toBeGreaterThan(v.createdAt.getTime());
          expect(m.dueDate.getTime()).toBeLessThanOrEqual(v.deadline.getTime());
          if (i > 0) expect(m.dueDate.getTime()).toBeGreaterThanOrEqual(v.milestones[i - 1].dueDate.getTime());
        }
      }
    }
  });

  it('copies the accepted version into its contract', () => {
    for (const [index, c] of big.contracts.entries()) {
      const p = big.proposals[c.proposal];
      expect(p.contract).toBe(index);
      const latest = p.versions.at(-1)!;
      expect([c.jobId, c.clientId, c.freelancerId]).toEqual([p.jobId, p.clientId, p.freelancerId]);
      expect(c.total).toBe(latest.total);
      expect(c.deadline.getTime()).toBe(latest.deadline.getTime());
      expect(c.milestones.map((m) => [m.title, m.amount, m.dueDate.getTime()])).toEqual(
        latest.milestones.map((m) => [m.title, m.amount, m.dueDate.getTime()]),
      );
      expect(c.createdAt.getTime()).toBe(p.decidedAt!.getTime());
      expect(c.imported).toBe(false);
    }
  });

  it('shows contracts in every state: each current milestone status, each warning, each end reason', () => {
    const active = big.contracts.filter((c) => c.status === 'ACTIVE');
    for (const status of ['PENDING', 'FUNDED', 'SUBMITTED', 'CHANGES_REQUESTED']) {
      expect(active.some((c) => current(c)?.status === status)).toBe(true);
    }
    expect(active.some((c) => current(c)?.status === 'PENDING' && current(c)!.position > 1)).toBe(true);
    for (const flag of ['lateWarnedAt', 'silentWarnedAt', 'unfundedWarnedAt'] as const) {
      expect(active.some((c) => c.milestones.some((m) => m[flag] !== null))).toBe(true);
    }
    expect(big.contracts.some((c) => c.status === 'COMPLETED')).toBe(true);
    for (const reason of ['FREELANCER_LATE', 'CLIENT_SILENT', 'NOT_FUNDED', 'MUTUAL', 'CLIENT_ENDED']) {
      expect(big.contracts.some((c) => c.status === 'ENDED' && c.endReason === reason)).toBe(true);
    }
    expect(big.contracts.filter((c) => c.amendments.some((a) => a.status === 'OPEN'))).toHaveLength(1);
    expect(big.contracts.filter((c) => c.endRequestedById !== null)).toHaveLength(1);
  });

  it('prices every service with a proposal or contract (template shares add to 100), and about half of the rest', () => {
    const services = bigInput().services;
    const used = new Set(big.proposals.map((p) => p.jobId));
    for (const id of used) expect(big.serviceTerms.has(id)).toBe(true);
    for (const [, terms] of big.serviceTerms) {
      const rows = terms.milestoneTemplate;
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows.length).toBeLessThanOrEqual(4);
      expect(rows.reduce((sum, row) => sum + row.share, 0)).toBe(100);
      for (const row of rows) {
        expect(row.title.length).toBeGreaterThan(0);
        expect(Number.isInteger(row.share) && row.share > 0).toBe(true);
      }
      expect(Number.isInteger(terms.price)).toBe(true);
      expect(terms.price).toBeGreaterThanOrEqual(rows.length);
      expect(['REMOTE', 'ONSITE', 'BOTH']).toContain(terms.workMode);
      expect(terms.serviceArea === null).toBe(terms.workMode === 'REMOTE');
    }
    const unused = services.filter((s) => !used.has(s.id));
    const pricedUnused = unused.filter((s) => big.serviceTerms.has(s.id)).length;
    expect(pricedUnused).toBeGreaterThan(0);
    expect(pricedUnused).toBeLessThan(unused.length);
  });

  it('takes proposal and contract amounts from the service price split by its template', () => {
    expect(priceSplit(1000, [30, 40, 30])).toEqual([300, 400, 300]);
    expect(priceSplit(1001, [30, 40, 30])).toEqual([300, 400, 301]);
    for (const p of big.proposals) {
      const terms = big.serviceTerms.get(p.jobId)!;
      const latest = p.versions.at(-1)!;
      expect(latest.milestones.map((m) => m.title)).toEqual(terms.milestoneTemplate.map((row) => row.title));
      // The agreed total is the price, or lower when the client's credits did not reach it.
      expect(latest.total).toBeLessThanOrEqual(terms.price);
      if (latest.total === terms.price) {
        expect(latest.milestones.map((m) => m.amount)).toEqual(
          priceSplit(terms.price, terms.milestoneTemplate.map((row) => row.share)),
        );
      }
    }
    const atPrice = big.contracts.filter((c) => c.total === big.serviceTerms.get(c.jobId)!.price);
    expect(atPrice.length).toBeGreaterThan(big.contracts.length / 2);
  });

  it('makes the OPEN amendment one the other side can accept now (the same check as the app)', () => {
    // Several seeds, so the amended milestone is sometimes the last one and sometimes not.
    const seeds = [1, 2, 3, 4, 5, 6].map((seed) => buildActivity({ ...bigInput(), seed }));
    for (const run of [...runs.map((item) => item.big), ...seeds]) {
      const c = run.contracts.find((item) => item.amendments.length)!;
      const [amendment] = c.amendments;
      expect(amendment.proposerId).toBe(c.freelancerId);
      expect(() =>
        checkAmendment(
          {
            deadline: amendment.deadline ?? undefined,
            changes: amendment.changes.map((change) => ({ op: 'move', milestoneId: change.position, dueDate: change.dueDate })),
          },
          c.milestones.map((m) => ({ id: m.position, status: m.status, position: m.position, dueDate: m.dueDate })),
          c.deadline,
          now,
        ),
      ).not.toThrow();
    }
  });

  it('keeps every milestone state consistent with its contract', () => {
    for (const c of big.contracts) {
      expect(c.milestones.map((m) => m.position)).toEqual(c.milestones.map((_, i) => i + 1));
      for (const [i, m] of c.milestones.entries()) {
        if (i > 0) expect(m.dueDate.getTime()).toBeGreaterThanOrEqual(c.milestones[i - 1].dueDate.getTime());
        expect(m.submissions.map((s) => s.number)).toEqual(m.submissions.map((_, n) => n + 1));
        if (['SUBMITTED', 'APPROVED'].includes(m.status)) expect(m.submissions.length).toBeGreaterThan(0);
        if (m.status !== 'PENDING' && !(m.status === 'CANCELLED' && !m.fundedAt)) expect(m.fundedAt).not.toBeNull();
      }
      const statuses = c.milestones.map((m) => m.status);
      if (c.status === 'COMPLETED') {
        expect(statuses.every((s) => s === 'APPROVED')).toBe(true);
        expect(c.completedAt).not.toBeNull();
      }
      if (c.status === 'ENDED') {
        expect(statuses.every((s) => s === 'APPROVED' || s === 'CANCELLED')).toBe(true);
        expect(statuses).toContain('CANCELLED');
        expect(c.endedAt).not.toBeNull();
        expect(c.endRequestedById).toBeNull();
      }
      if (c.status === 'ACTIVE') {
        // Only the next milestone in order is funded: everything before the current one is approved.
        const index = c.milestones.indexOf(current(c)!);
        expect(statuses.slice(0, index).every((s) => s === 'APPROVED')).toBe(true);
        expect(statuses.slice(index + 1).every((s) => s === 'PENDING')).toBe(true);
        // Due dates still to come are in the future, except the one meant to show the late warning.
        for (const m of c.milestones.slice(index)) {
          if (m.lateWarnedAt === null) expect(m.dueDate.getTime()).toBeGreaterThan(now.getTime());
        }
      }
      expect(c.amendments.filter((a) => a.status === 'OPEN').length).toBeLessThanOrEqual(1);
    }
  });

  it('leaves every ACTIVE contract alone for the sweeper at the seed time (default and short windows)', () => {
    for (const { graceMinutes, big: run } of runs) {
      for (const c of run.contracts.filter((item) => item.status === 'ACTIVE')) {
        const sweep = {
          status: c.status,
          imported: c.imported,
          createdAt: c.createdAt,
          milestones: c.milestones.map((m) => ({ ...m, id: m.position })),
        };
        expect(evaluateDeadlines(sweep, now, graceMinutes)).toBeNull();
        // The warning ones were warned already: their flag is set and the window is still open.
        const warned = c.milestones.some((m) => m.lateWarnedAt || m.silentWarnedAt || m.unfundedWarnedAt);
        expect(warned).toBe(WARNING_SCENARIOS.includes(c.scenario));
      }
    }
  });

  it('gives every seeded person a wallet that adds up: SEED 5,000 first, then the moves in time order', () => {
    for (const { big: run } of runs) {
      expect(run.wallets.map((w) => w.userId).sort((a, b) => a - b)).toEqual(
        bigInput().people.map((p) => p.id).sort((a, b) => a - b),
      );
      for (const wallet of run.wallets) {
        const rows = run.ledger.filter((row) => row.userId === wallet.userId);
        expect(rows[0]).toMatchObject({ type: 'SEED', availableDelta: 5000, heldDelta: 0 });
        expect(rows.filter((row) => row.type === 'SEED')).toHaveLength(1);
        let available = 0;
        let held = 0;
        for (const [i, row] of rows.entries()) {
          if (i > 0) expect(row.createdAt.getTime()).toBeGreaterThanOrEqual(rows[i - 1].createdAt.getTime());
          expect(row.availableDelta !== 0 || row.heldDelta !== 0).toBe(true);
          available += row.availableDelta;
          held += row.heldDelta;
          expect(row.availableAfter).toBe(available);
          expect(row.heldAfter).toBe(held);
          expect(available).toBeGreaterThanOrEqual(0);
          expect(held).toBeGreaterThanOrEqual(0);
        }
        expect(wallet.available).toBe(available);
        expect(wallet.held).toBe(held);
        const heldMilestones = run.contracts
          .filter((c) => c.clientId === wallet.userId)
          .flatMap((c) => c.milestones)
          .filter((m) => HELD.includes(m.status))
          .reduce((sum, m) => sum + m.amount, 0);
        expect(wallet.held).toBe(heldMilestones);
      }
    }
  });

  it('writes the money moves of each milestone: one RELEASE pair per APPROVED, none for imported contracts', () => {
    for (const [index, c] of big.contracts.entries()) {
      const rows = big.ledger.filter((row) => row.contract === index);
      if (c.imported) expect(rows).toHaveLength(0);
      for (const m of c.milestones) {
        const mine = rows.filter((row) => row.position === m.position);
        const of = (type: string) => mine.filter((row) => row.type === type);
        const release = of('RELEASE');
        if (m.status === 'APPROVED') {
          expect(release).toHaveLength(2);
          expect(release.find((row) => row.userId === c.clientId)).toMatchObject({ availableDelta: 0, heldDelta: -m.amount, counterpartyId: c.freelancerId });
          expect(release.find((row) => row.userId === c.freelancerId)).toMatchObject({ availableDelta: m.amount, heldDelta: 0, counterpartyId: c.clientId });
        } else {
          expect(release).toHaveLength(0);
        }
        expect(of('FUND_HOLD')).toHaveLength(m.fundedAt ? 1 : 0);
        expect(of('REFUND')).toHaveLength(m.status === 'CANCELLED' && m.fundedAt ? 1 : 0);
      }
    }
  });

  it('reviews only COMPLETED contracts or ENDED ones with approved work, about 70% of the completed', () => {
    for (const c of big.contracts) {
      if (!c.review) continue;
      const approved = c.milestones.some((m) => m.status === 'APPROVED');
      expect(c.status === 'COMPLETED' || (c.status === 'ENDED' && approved)).toBe(true);
      expect(c.review.commentedAt.getTime()).toBeGreaterThanOrEqual((c.completedAt ?? c.endedAt)!.getTime());
      expect(c.events.filter((e) => e.type === 'review_left')).toHaveLength(1);
    }
    const completed = big.contracts.filter((c) => c.status === 'COMPLETED');
    const reviewed = completed.filter((c) => c.review).length / completed.length;
    expect(reviewed).toBeGreaterThan(0.4);
    expect(reviewed).toBeLessThan(1);
  });

  it('writes history in time order, ending with the step that matches the state, and one notice for it', () => {
    const lastStep: Record<string, string> = { DECLINED: 'proposal_declined', WITHDRAWN: 'proposal_withdrawn', EXPIRED: 'proposal_expired' };
    for (const p of big.proposals) {
      const times = p.events.map((e) => e.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(p.events[0]).toMatchObject({ type: 'proposal_sent', actorId: p.clientId });
      if (lastStep[p.status]) expect(p.events.at(-1)!.type).toBe(lastStep[p.status]);
      expect(p.notices).toHaveLength(p.status === 'ACCEPTED' ? 0 : 1);
    }
    for (const c of big.contracts) {
      const times = c.events.map((e) => e.createdAt.getTime());
      expect(times).toEqual([...times].sort((a, b) => a - b));
      expect(c.events.slice(0, 2).map((e) => e.type)).toEqual(['proposal_accepted', 'contract_started']);
      if (c.status === 'COMPLETED') expect(c.events.map((e) => e.type)).toContain('contract_completed');
      if (c.status === 'ENDED') expect(c.events.find((e) => e.type === 'contract_ended')?.data).toEqual({ reason: c.endReason });
      expect(c.updatedAt.getTime()).toBe(c.events.at(-1)!.createdAt.getTime());
      expect(c.notices).toHaveLength(1);
      const last = c.events.at(-1)!.type;
      expect(c.notices[0].step).toBe(last === 'contract_started' ? 'proposal_accepted' : last);
      expect(c.notices[0].recipientId).not.toBe(c.notices[0].actorId);
    }
  });

  it('keeps every date in the past, apart from due dates, deadlines and proposal expiry', () => {
    const dates = [
      ...big.proposals.flatMap((p) => [p.createdAt, p.updatedAt, p.decidedAt, ...p.versions.map((v) => v.createdAt), ...p.events.map((e) => e.createdAt)]),
      ...big.contracts.flatMap((c) => [
        c.createdAt, c.updatedAt, c.completedAt, c.endedAt, c.endRequestedAt, c.review?.commentedAt,
        ...c.events.map((e) => e.createdAt),
        ...c.amendments.map((a) => a.createdAt),
        ...c.milestones.flatMap((m) => [m.fundedAt, m.submittedAt, m.changesRequestedAt, m.approvedAt, m.cancelledAt,
          m.lateWarnedAt, m.silentWarnedAt, m.unfundedWarnedAt, ...m.submissions.map((s) => s.createdAt)]),
      ]),
      ...big.ledger.map((row) => row.createdAt),
      ...big.wallets.flatMap((w) => [w.createdAt, w.updatedAt]),
    ];
    for (const date of dates) if (date) expect(date.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('adds the proposal and milestone chat lines in the pair chat', () => {
    const texts = big.chats.flatMap((chat) => chat.messages.map((message) => message.content));
    expect(texts.some((text) => /^I sent a proposal for ".+": [\d,]+ credits in \d milestones?\.$/.test(text))).toBe(true);
    expect(texts.some((text) => /^I accepted the proposal for ".+"\. The contract has started\.$/.test(text))).toBe(true);
    expect(texts.some((text) => /^I funded milestone \d ".+" \([\d,]+ credits\)\. You can start\.$/.test(text))).toBe(true);
  });
});

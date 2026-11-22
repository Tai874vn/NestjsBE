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
    for (const hire of activity.hires) expect(hire.hirerId).not.toBe(2);
    for (const hire of activity.hires) if (hire.review) expect(hire.completed).toBe(true);
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
    services: [],
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

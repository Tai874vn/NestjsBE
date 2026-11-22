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

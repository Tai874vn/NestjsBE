import {
  after,
  between,
  firstName,
  list,
  occupationFit,
  years,
  type Activity,
  type ActivityContext,
  type Level,
  type Person,
  type ServiceFact,
} from './activity-shared';

type FeedPost = Activity['feedPosts'][number];
type DraftComment = { authorId: number; content: string; notBefore?: Date };

type FeedHelpers = {
  ctx: ActivityContext;
  friends: Map<number, number[]>;
  servicesBy: Map<number, ServiceFact[]>;
  feedPosts: FeedPost[];
  addPost: (
    authorId: number,
    content: string,
    createdAt: Date,
    comments: DraftComment[],
    reply: string | null,
  ) => FeedPost;
  commenters: (authorId: number, count: number) => number[];
};

/**
 * Build feed posts with likes, comments, author replies and saves.
 * Candidate posts run before recruiter hiring-announcement posts, then all posts are sorted by time.
 */
export function buildFeedPosts(
  ctx: ActivityContext,
  joinedAt: Map<number, Date>,
  hiringPostCreatedAt: Map<number, Date>,
  applications: Activity['applications'],
  friends: Map<number, number[]>,
): Activity['feedPosts'] {
  const servicesBy = groupServicesByCreator(ctx.input.services);
  const applicantsOf = groupApplicationsByPost(applications);
  const feedPosts: FeedPost[] = [];

  const helpers: FeedHelpers = {
    ctx,
    friends,
    servicesBy,
    feedPosts,
    addPost: (authorId, content, createdAt, comments, reply) =>
      addFeedPost(
        ctx,
        friends,
        feedPosts,
        authorId,
        content,
        createdAt,
        comments,
        reply,
      ),
    commenters: (authorId, count) =>
      ctx.random.shuffle(friends.get(authorId) ?? []).slice(0, count),
  };

  addCandidateFeedPosts(helpers, joinedAt);
  addRecruiterHiringFeedPosts(helpers, hiringPostCreatedAt, applicantsOf);
  feedPosts.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return feedPosts;
}

function groupServicesByCreator(
  services: ServiceFact[],
): Map<number, ServiceFact[]> {
  const byCreator = new Map<number, ServiceFact[]>();
  for (const service of services) {
    byCreator.set(service.creatorId, [
      ...(byCreator.get(service.creatorId) ?? []),
      service,
    ]);
  }
  return byCreator;
}

function groupApplicationsByPost(
  applications: Activity['applications'],
): Map<number, Activity['applications']> {
  const byPost = new Map<number, Activity['applications']>();
  for (const application of applications) {
    byPost.set(application.hiringPostId, [
      ...(byPost.get(application.hiringPostId) ?? []),
      application,
    ]);
  }
  return byPost;
}

/** Add likes from connections, timed comments and an optional author reply to a new feed post. */
function addFeedPost(
  ctx: ActivityContext,
  friends: Map<number, number[]>,
  feedPosts: FeedPost[],
  authorId: number,
  content: string,
  createdAt: Date,
  comments: DraftComment[],
  reply: string | null,
): FeedPost {
  const { random, now } = ctx;
  const audience = random.shuffle(friends.get(authorId) ?? []);
  const likes = audience
    .filter(() => random.chance(0.55))
    .map((userId) => ({
      userId,
      createdAt: after(random, createdAt, 0.2, 72, now),
    }));
  const timed = comments
    .filter((comment) => comment.authorId !== authorId)
    .map(({ notBefore, ...comment }) => ({
      ...comment,
      createdAt: after(
        random,
        notBefore && notBefore > createdAt ? notBefore : createdAt,
        0.5,
        60,
        now,
      ),
    }))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const withReply: FeedPost['comments'] = [...timed];
  if (reply && timed.length && random.chance(0.6)) {
    withReply.push({
      authorId,
      content: reply,
      createdAt: after(random, timed[0].createdAt, 0.5, 24, now),
      replyTo: 0,
    });
  }
  const post: FeedPost = {
    authorId,
    content,
    createdAt,
    likes,
    comments: withReply,
    savedBy: [],
  };
  feedPosts.push(post);
  return post;
}

function addCandidateFeedPosts(
  helpers: FeedHelpers,
  joinedAt: Map<number, Date>,
): void {
  const { ctx } = helpers;
  const { random, candidates, title, ago } = ctx;

  for (const candidate of candidates) {
    const occupation = title(candidate.occupation);
    const kinds = random
      .shuffle(['project', 'milestone', 'learning', 'open'] as const)
      .slice(0, random.int(0, 2));
    for (const kind of kinds) {
      const createdAt = between(random, joinedAt.get(candidate.id)!, ago(0.2));
      const skill = candidate.skills.length
        ? random.pick(candidate.skills)
        : null;
      if (kind === 'project') {
        addProjectPost(helpers, candidate, createdAt, skill);
      } else if (kind === 'milestone' && candidate.years >= 1) {
        addMilestonePost(helpers, candidate, occupation, createdAt);
      } else if (kind === 'learning' && skill) {
        addLearningPost(helpers, candidate, occupation, createdAt, skill);
      } else if (kind === 'open' && candidate.discoverable) {
        addOpenToWorkPost(helpers, candidate, occupation, createdAt);
      }
    }
  }
}

function addProjectPost(
  helpers: FeedHelpers,
  candidate: Person,
  createdAt: Date,
  skill: string | null,
): void {
  const { ctx, servicesBy, addPost, commenters } = helpers;
  const { random } = ctx;
  const service = random.pick(servicesBy.get(candidate.id) ?? [null]);
  if (!service) return;
  const result = /Result: ([^.]+)\./.exec(service.description)?.[1];
  const comments = commenters(candidate.id, random.int(0, 3)).map(
    (id, index) => ({
      authorId: id,
      content: [
        `Nice work, ${firstName(candidate)}! How long did it take?`,
        skill
          ? `Did you use ${skill} for the main part?`
          : 'What was the hardest part?',
        'Great result. Would love to read a write-up.',
      ][index % 3],
    }),
  );
  const reply = `Thanks! About ${random.int(3, 10)} weeks${skill ? `, mostly with ${skill}` : ''}.`;
  addPost(
    candidate.id,
    `Wrapped up "${service.title}"${builtWith(service)}.${result ? ` Result: ${result}.` : ''} Happy to share what I learned.`,
    createdAt,
    comments,
    reply,
  );
}

function addMilestonePost(
  helpers: FeedHelpers,
  candidate: Person,
  occupation: string,
  createdAt: Date,
): void {
  const { ctx, addPost, commenters } = helpers;
  const { random } = ctx;
  const content = `${years(candidate.years)} as a ${occupation} this month. Biggest lesson so far: ${random.pick(LESSONS[candidate.level ?? 'Mid'])}`;
  const comments = commenters(candidate.id, random.int(1, 3)).map(
    (id, index) => ({
      authorId: id,
      content: [
        `Congrats, ${firstName(candidate)}!`,
        'Well deserved.',
        'So true about that lesson.',
      ][index % 3],
    }),
  );
  addPost(candidate.id, content, createdAt, comments, 'Thank you all!');
}

function addLearningPost(
  helpers: FeedHelpers,
  candidate: Person,
  occupation: string,
  createdAt: Date,
  skill: string,
): void {
  const { ctx, addPost, commenters } = helpers;
  const { random } = ctx;
  const comments = commenters(candidate.id, random.int(0, 2)).map(
    (id, index) => ({
      authorId: id,
      content: [
        `The official ${skill} documentation is a good start, then a small real project.`,
        `I learned ${skill} by rebuilding something I use at work. Worth trying.`,
      ][index % 2],
    }),
  );
  addPost(
    candidate.id,
    `Spending this week going deeper into ${skill}. Any good resources for using it in ${occupation} work?`,
    createdAt,
    comments,
    'Thanks, I will try that.',
  );
}

function addOpenToWorkPost(
  helpers: FeedHelpers,
  candidate: Person,
  occupation: string,
  createdAt: Date,
): void {
  const { ctx, addPost } = helpers;
  const { input, random, now, related, recruiters } = ctx;
  const top = candidate.skills.slice(0, 3);
  const post = addPost(
    candidate.id,
    `Open to new ${occupation} roles in ${candidate.location} or remote. ${years(candidate.years)} of experience${top.length ? `, mostly with ${list(top)}` : ''}. Messages welcome.`,
    createdAt,
    [],
    null,
  );
  // Recruiters hiring for this occupation notice and save the post.
  for (const recruiter of recruiters) {
    const hiring = input.hiringPosts.some(
      (item) =>
        item.recruiterId === recruiter.id &&
        occupationFit(item.occupationCode, candidate.occupation, related) >=
          0.5,
    );
    if (hiring && random.chance(0.6)) {
      post.savedBy.push({
        userId: recruiter.id,
        createdAt: after(random, createdAt, 1, 72, now),
      });
    }
  }
}

function addRecruiterHiringFeedPosts(
  helpers: FeedHelpers,
  hiringPostCreatedAt: Map<number, Date>,
  applicantsOf: Map<number, Activity['applications']>,
): void {
  const { ctx, addPost } = helpers;
  const { input, random, now, related, people, candidates } = ctx;

  for (const post of input.hiringPosts) {
    if (!random.chance(0.7)) continue;
    const recruiter = people.get(post.recruiterId)!;
    const createdAt = after(
      random,
      hiringPostCreatedAt.get(post.id)!,
      0.1,
      6,
      now,
    );
    const applied = (applicantsOf.get(post.id) ?? []).filter(
      (application) => application.status !== 'WITHDRAWN',
    );
    const comments: DraftComment[] = [
      ...applied.slice(0, 2).map((application) => ({
        authorId: application.applicantId,
        notBefore: application.createdAt,
        content: random.pick([
          'Applied!',
          'Just sent my application.',
          'Applied, looking forward to hearing back.',
        ]),
      })),
      ...(random.chance(0.4)
        ? [
            {
              authorId: random.pick(candidates).id,
              content: 'Is remote work possible for this role?',
            },
          ]
        : []),
    ];
    const feedPost = addPost(
      post.recruiterId,
      `${recruiter.company ? `${recruiter.company} is hiring` : 'We are hiring'}: ${post.title} in ${post.location} (${post.employmentType}). ` +
        `Looking for ${post.yearsRequired === 0 ? 'people starting out' : `at least ${years(post.yearsRequired)} of experience`}` +
        `${post.skills.length ? ` with ${list(post.skills.slice(0, 3))}` : ''}. Details and applications: /hiring-posts/${post.id}`,
      createdAt,
      comments,
      `Thanks! ${post.location} first, with some remote days. Apply on the post and we will reply within a week.`,
    );
    for (const candidate of candidates) {
      if (
        occupationFit(candidate.occupation, post.occupationCode, related) >=
          0.5 &&
        random.chance(0.25)
      ) {
        feedPost.savedBy.push({
          userId: candidate.id,
          createdAt: after(random, createdAt, 1, 96, now),
        });
      }
    }
  }
}

/** ", built with GitHub, Redis" from a summary like "Admin dashboard, built with GitHub, Redis." */
function builtWith(service: ServiceFact): string {
  const match = /,( built with .+?)\.?$/.exec(service.summary);
  return match ? `,${match[1]}` : '';
}

const LESSONS: Record<Level, string[]> = {
  Junior: [
    'ask questions early instead of guessing.',
    'small, finished tasks beat big unfinished ones.',
    'read the existing work before changing it.',
  ],
  Mid: [
    'write things down; future you will thank you.',
    'the simplest solution is usually the one that lasts.',
    'a good review is a conversation, not a verdict.',
  ],
  Senior: [
    'the best help you can give a team is clear priorities.',
    'mentoring pays back more than any shortcut.',
    'say no to good ideas so the great ones get done.',
  ],
};

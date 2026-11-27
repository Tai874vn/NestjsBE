import { formatVietnamTime } from '../../modules/hiring-pipeline/utils/interview-times';
import type { HiringEventType } from '../../modules/hiring-pipeline/services/hiring-events.service';
import {
  DAY,
  HOUR,
  after,
  applicationFit,
  between,
  firstName,
  list,
  years,
  type Activity,
  type ActivityContext,
  type ApplicationStatus,
  type EventFact,
  type HiringPostFact,
  type InterviewFact,
  type NoticeFact,
  type Person,
  type Random,
} from './activity-shared';

type ApplicationFact = Activity['applications'][number];
type ApplicationMeta = { posted: Date; ageDays: number };

type ApplicationStoryContext = {
  ctx: ActivityContext;
  application: ApplicationFact;
  post: HiringPostFact;
  candidate: Person;
  recruiter: Person;
  meta: ApplicationMeta;
  events: EventFact[];
  shortlistedAt: Date;
};

export type HiringActivity = {
  applications: Activity['applications'];
  openings: Map<number, number>;
};

/**
 * Build applications, hiring pipeline stages, post openings, interviews, events and notices.
 * Order matters for the seeded RNG: create initial applications first, promote shortlisted ones next,
 * then generate interview/offer/event history for each application.
 */
export function buildHiringActivity(
  ctx: ActivityContext,
  hiringPostCreatedAt: Map<number, Date>,
): HiringActivity {
  const { applications, meta } = createInitialApplications(
    ctx,
    hiringPostCreatedAt,
  );
  advanceShortlistedApplications(ctx.random, applications, meta);
  showcaseDemoStory(ctx, applications, meta, hiringPostCreatedAt);
  const openings = computePostOpenings(ctx.input.hiringPosts, applications);
  populateApplicationsHistory(ctx, applications, meta);
  return { applications, openings };
}

/** Pick fitting candidates for each hiring post and give each application a starting status. */
function createInitialApplications(
  ctx: ActivityContext,
  hiringPostCreatedAt: Map<number, Date>,
): { applications: ApplicationFact[]; meta: ApplicationMeta[] } {
  const { input, random, now, related, candidates, title } = ctx;
  const applications: ApplicationFact[] = [];
  const meta: ApplicationMeta[] = [];

  for (const post of input.hiringPosts) {
    const posted = hiringPostCreatedAt.get(post.id)!;
    const ageDays = (now.getTime() - posted.getTime()) / DAY;
    const fits = candidates
      .map((candidate) => ({
        candidate,
        fit: applicationFit(candidate, post, related),
      }))
      .filter((entry) => entry.fit >= 0.25)
      .sort((a, b) => b.fit - a.fit || a.candidate.id - b.candidate.id);
    const chosen = fits.slice(0, Math.min(fits.length, random.int(2, 8)));

    let accepted = false;
    for (const [rank, { candidate, fit }] of chosen.entries()) {
      const createdAt = between(
        random,
        posted,
        new Date(Math.min(now.getTime(), posted.getTime() + 10 * DAY)),
      );
      const status = pickInitialStatus(random, ageDays, rank, fit, accepted);
      if (status === 'HIRED') accepted = true;
      const updatedAt =
        status === 'APPLIED'
          ? createdAt
          : after(random, createdAt, 12, 96, now);

      applications.push({
        hiringPostId: post.id,
        applicantId: candidate.id,
        status,
        coverLetter: buildCoverLetter(random, candidate, post, title),
        offerNote: null,
        offeredAt: null,
        decidedAt: null,
        createdAt,
        updatedAt,
        interviews: [],
        events: [],
        notices: [],
      });
      meta.push({ posted, ageDays });
    }
  }

  return { applications, meta };
}

function pickInitialStatus(
  random: Random,
  ageDays: number,
  rank: number,
  fit: number,
  accepted: boolean,
): ApplicationStatus {
  if (ageDays > 7) {
    if (!accepted && rank === 0 && fit >= 0.9 && random.chance(0.6)) {
      return 'HIRED';
    }
    if (fit < 0.5 && random.chance(0.7)) return 'REJECTED';
    if (rank <= 2 && random.chance(0.6)) return 'REVIEWING';
    if (random.chance(0.07)) return 'WITHDRAWN';
    return 'APPLIED';
  }
  if (ageDays > 2 && rank <= 1 && random.chance(0.5)) return 'REVIEWING';
  return 'APPLIED';
}

/**
 * Move shortlisted applicants along the pipeline: up to 5 (on distinct posts older than a week)
 * receive an offer, and about 40% of the remaining shortlisted ones enter interviews.
 */
function advanceShortlistedApplications(
  random: Random,
  applications: ApplicationFact[],
  meta: ApplicationMeta[],
): void {
  const offerPosts = new Set<number>();
  let offers = 0;
  for (const index of random.shuffle(applications.map((_, i) => i))) {
    const application = applications[index];
    if (application.status !== 'REVIEWING') continue;
    if (
      offers < 5 &&
      meta[index].ageDays > 7 &&
      !offerPosts.has(application.hiringPostId)
    ) {
      application.status = 'OFFERED';
      offerPosts.add(application.hiringPostId);
      offers += 1;
    } else if (random.chance(0.4)) {
      application.status = 'INTERVIEWING';
    }
  }
}

/**
 * Give the demo candidate one application in every main step, so the demo can show the whole pipeline:
 * an online interview that is booked, an offer to answer, a shortlist, a past hire, a new application and a
 * rejection. Posts of the demo recruiter come first, so the recruiter's applicant board shows the same story
 * from the other side. Posts must fit the candidate (same rule as everyone: applicationFit >= 0.25); an offer or
 * a hire needs a post older than a week, and any other offer or hire on that post goes back to the shortlist.
 */
function showcaseDemoStory(
  ctx: ActivityContext,
  applications: ApplicationFact[],
  meta: ApplicationMeta[],
  hiringPostCreatedAt: Map<number, Date>,
): void {
  const { input, random, now, related, title } = ctx;
  const candidate = ctx.candidates.find((person) => person.demo);
  const recruiter = ctx.recruiters.find((person) => person.demo);
  if (!candidate || !recruiter) return;
  const ageOf = (postId: number) =>
    (now.getTime() - hiringPostCreatedAt.get(postId)!.getTime()) / DAY;
  const fits = input.hiringPosts
    .map((post) => ({ post, fit: applicationFit(candidate, post, related) }))
    .filter((entry) => entry.fit >= 0.25)
    .sort(
      (a, b) =>
        Number(b.post.recruiterId === recruiter.id) -
          Number(a.post.recruiterId === recruiter.id) ||
        b.fit - a.fit ||
        a.post.id - b.post.id,
    );
  const used = new Set<number>();
  const steps: ApplicationStatus[] = ['INTERVIEWING', 'OFFERED', 'REVIEWING', 'HIRED', 'APPLIED', 'REJECTED'];
  for (const status of steps) {
    const needsOld = status === 'OFFERED' || status === 'HIRED';
    const choice = fits.find(
      ({ post }) => !used.has(post.id) && (!needsOld || ageOf(post.id) > 7),
    );
    if (!choice) continue;
    const { post } = choice;
    used.add(post.id);
    if (needsOld) {
      // One offer or hire per post: others on the post go back to the shortlist.
      for (const other of applications) {
        if (other.hiringPostId === post.id && other.applicantId !== candidate.id &&
            (other.status === 'OFFERED' || other.status === 'HIRED')) other.status = 'REVIEWING';
      }
    }
    let index = applications.findIndex(
      (item) => item.hiringPostId === post.id && item.applicantId === candidate.id,
    );
    if (index < 0) {
      const posted = hiringPostCreatedAt.get(post.id)!;
      const createdAt = between(random, posted, new Date(Math.min(now.getTime(), posted.getTime() + 3 * DAY)));
      applications.push({
        hiringPostId: post.id,
        applicantId: candidate.id,
        status,
        coverLetter: buildCoverLetter(random, candidate, post, title),
        offerNote: null,
        offeredAt: null,
        decidedAt: null,
        createdAt,
        updatedAt: createdAt,
        interviews: [],
        events: [],
        notices: [],
      });
      meta.push({ posted, ageDays: ageOf(post.id) });
      index = applications.length - 1;
    }
    const application = applications[index];
    application.status = status;
    application.updatedAt =
      status === 'APPLIED' ? application.createdAt : after(random, application.createdAt, 12, 96, now);
  }
}

/** A post with a hired person has 2 openings (one hired and room for one offer); others have 1. */
function computePostOpenings(
  hiringPosts: HiringPostFact[],
  applications: ApplicationFact[],
): Map<number, number> {
  const openings = new Map<number, number>();
  for (const post of hiringPosts) {
    openings.set(
      post.id,
      applications.some(
        (item) => item.hiringPostId === post.id && item.status === 'HIRED',
      )
        ? 2
        : 1,
    );
  }
  return openings;
}

/** Fill interviews, timeline events and latest notification for each application based on its status. */
function populateApplicationsHistory(
  ctx: ActivityContext,
  applications: ApplicationFact[],
  meta: ApplicationMeta[],
): void {
  for (const [index, application] of applications.entries()) {
    const post = ctx.postById.get(application.hiringPostId)!;
    const candidate = ctx.people.get(application.applicantId)!;
    const recruiter = ctx.people.get(post.recruiterId)!;
    const events: EventFact[] = [
      makeEvent('applied', candidate.id, application.createdAt),
    ];
    const story: ApplicationStoryContext = {
      ctx,
      application,
      post,
      candidate,
      recruiter,
      meta: meta[index],
      events,
      shortlistedAt: application.updatedAt,
    };

    if (application.status === 'OFFERED' || application.status === 'HIRED') {
      fillOfferedOrHired(story);
    } else if (application.status === 'INTERVIEWING') {
      fillInterviewing(story);
    } else if (application.status === 'REVIEWING') {
      fillReviewing(story);
    } else if (application.status === 'REJECTED') {
      fillRejected(story);
    } else if (application.status === 'WITHDRAWN') {
      fillWithdrawn(story);
    } else {
      fillApplied(story);
    }
    application.events = events;
  }
}

function fillOfferedOrHired(story: ApplicationStoryContext): void {
  const { ctx, application, post, candidate, recruiter, meta, events } = story;
  const { random, now } = ctx;
  // The interview took place 4-9 days ago, and after the post was a couple of days old.
  const daysAgo = random.int(4, Math.min(9, Math.floor(meta.ageDays - 2.5)));
  const scheduledAt = vietnamAt(
    random,
    new Date(now.getTime() - daysAgo * DAY),
  );
  const completedAt = new Date(scheduledAt.getTime() + 0.75 * HOUR);
  application.createdAt = between(
    random,
    meta.posted,
    new Date(scheduledAt.getTime() - DAY),
  );
  events[0].createdAt = application.createdAt;

  const span = scheduledAt.getTime() - application.createdAt.getTime();
  const at = (share: number) =>
    new Date(application.createdAt.getTime() + span * share);
  const done = createInterview(post.recruiterId, {
    proposedTimes: [scheduledAt],
    scheduledAt,
    status: 'COMPLETED',
    completedAt,
    createdAt: at(0.4),
    updatedAt: completedAt,
  });
  application.interviews.push(done);
  application.offerNote = random.pick([
    `We would like to offer you the ${post.title} role. Salary, start date and benefits are in the offer.`,
    `Thank you for the interview. We are happy to offer you the ${post.title} role; please read the details and tell us what you think.`,
  ]);
  application.offeredAt = after(random, completedAt, 2, 24, now);
  events.push(
    makeEvent('shortlisted', post.recruiterId, at(0.2)),
    interviewRequestedEvent(post.recruiterId, done),
    makeEvent('interview_booked', candidate.id, at(0.6), {
      interview: 0,
      data: { scheduledAt: scheduledAt.toISOString() },
    }),
    makeEvent('interview_completed', post.recruiterId, completedAt, {
      interview: 0,
    }),
    makeEvent('offer_sent', post.recruiterId, application.offeredAt, {
      data: { note: application.offerNote },
    }),
  );
  application.updatedAt = application.offeredAt;

  if (application.status === 'HIRED') {
    application.decidedAt = after(random, application.offeredAt, 3, 48, now);
    events.push(makeEvent('hired', candidate.id, application.decidedAt));
    application.updatedAt = application.decidedAt;
    application.notices.push(
      makeNotice(
        post,
        candidate,
        'application',
        true,
        'Offer accepted',
        `${candidate.name} accepted the offer for ${post.title}.`,
        application.decidedAt,
      ),
    );
  } else {
    application.notices.push(
      makeNotice(
        post,
        candidate,
        'application',
        false,
        'Offer received',
        `${recruiter.name} sent you an offer for ${post.title}.`,
        application.offeredAt,
      ),
    );
  }
}

function fillInterviewing(story: ApplicationStoryContext): void {
  const {
    ctx,
    application,
    post,
    candidate,
    recruiter,
    events,
    shortlistedAt,
  } = story;
  const { random, now } = ctx;
  const requestedAt = after(random, shortlistedAt, 1, 24, now);
  const days = random
    .shuffle([1, 2, 3, 4, 5])
    .slice(0, 3)
    .sort((a, b) => a - b);
  const proposedTimes = days.map((day) =>
    vietnamAt(random, new Date(now.getTime() + day * DAY)),
  );
  // The demo candidate's interview is always booked, so the video call can be shown during the demo.
  const scheduled = candidate.demo ? true : random.chance(0.6);
  const picked = random.pick(proposedTimes);
  const open = createInterview(post.recruiterId, {
    proposedTimes,
    scheduledAt: scheduled ? picked : null,
    status: scheduled ? 'SCHEDULED' : 'PROPOSED',
    completedAt: null,
    createdAt: requestedAt,
    updatedAt: requestedAt,
  });
  application.interviews.push(open);
  events.push(
    makeEvent('shortlisted', post.recruiterId, shortlistedAt),
    interviewRequestedEvent(post.recruiterId, open),
  );
  application.updatedAt = requestedAt;

  if (scheduled) {
    const bookedAt = after(random, requestedAt, 1, 24, now);
    events.push(
      makeEvent('interview_booked', candidate.id, bookedAt, {
        interview: 0,
        data: { scheduledAt: picked.toISOString() },
      }),
    );
    open.updatedAt = bookedAt;
    application.updatedAt = bookedAt;
    application.notices.push(
      makeNotice(
        post,
        candidate,
        'interview',
        true,
        'Interview booked',
        `${candidate.name} picked ${formatVietnamTime(picked)} (Vietnam time) for the ${post.title} interview.`,
        bookedAt,
      ),
    );
  } else {
    application.notices.push(
      makeNotice(
        post,
        candidate,
        'interview',
        false,
        'Interview request',
        `${recruiter.name} invited you to an interview for ${post.title}. Pick one of the times.`,
        requestedAt,
      ),
    );
  }
}

function fillReviewing(story: ApplicationStoryContext): void {
  const { application, post, candidate, recruiter, events, shortlistedAt } =
    story;
  events.push(makeEvent('shortlisted', post.recruiterId, shortlistedAt));
  application.notices.push(
    makeNotice(
      post,
      candidate,
      'application',
      false,
      'You are on the shortlist',
      `${recruiter.name} shortlisted you for ${post.title}.`,
      shortlistedAt,
    ),
  );
}

function fillRejected(story: ApplicationStoryContext): void {
  const { ctx, application, post, candidate, events } = story;
  if (ctx.random.chance(0.3)) {
    events.push(
      makeEvent(
        'shortlisted',
        post.recruiterId,
        between(ctx.random, application.createdAt, application.updatedAt),
      ),
    );
  }
  events.push(
    makeEvent('rejected', post.recruiterId, application.updatedAt, {
      data: { reason: null },
    }),
  );
  application.notices.push(
    makeNotice(
      post,
      candidate,
      'application',
      false,
      'Application update',
      `${post.title}: not selected.`,
      application.updatedAt,
    ),
  );
}

function fillWithdrawn(story: ApplicationStoryContext): void {
  const { application, post, candidate, events } = story;
  events.push(makeEvent('withdrawn', candidate.id, application.updatedAt));
  application.notices.push(
    makeNotice(
      post,
      candidate,
      'application',
      true,
      'Application withdrawn',
      `${candidate.name} withdrew the application for ${post.title}.`,
      application.updatedAt,
    ),
  );
}

function fillApplied(story: ApplicationStoryContext): void {
  const { application, post, candidate } = story;
  application.notices.push(
    makeNotice(
      post,
      candidate,
      'received',
      true,
      'New application',
      `${candidate.name} applied to ${post.title}.`,
      application.createdAt,
    ),
  );
}

/** Pick an interview slot in Vietnam time (UTC+7) between 09:00 and 16:30. */
function vietnamAt(random: Random, day: Date): Date {
  return new Date(
    Math.floor((day.getTime() + 7 * HOUR) / DAY) * DAY -
      7 * HOUR +
      random.int(9, 16) * HOUR +
      (random.chance(0.5) ? HOUR / 2 : 0),
  );
}

function createInterview(
  recruiterId: number,
  fields: Pick<
    InterviewFact,
    | 'proposedTimes'
    | 'scheduledAt'
    | 'status'
    | 'completedAt'
    | 'createdAt'
    | 'updatedAt'
  >,
): InterviewFact {
  return {
    round: 1,
    mode: 'ONLINE',
    durationMinutes: 45,
    // An online interview has no link: the video call runs inside the app (LiveKit).
    location: null,
    note: null,
    createdById: recruiterId,
    ...fields,
  };
}

function interviewRequestedEvent(
  recruiterId: number,
  item: InterviewFact,
): EventFact {
  return {
    type: 'interview_requested',
    actorId: recruiterId,
    createdAt: item.createdAt,
    interview: 0,
    data: {
      round: item.round,
      mode: item.mode,
      proposedTimes: item.proposedTimes.map((time) => time.toISOString()),
    },
  };
}

function makeEvent(
  type: HiringEventType,
  actorId: number,
  createdAt: Date,
  extra: Partial<EventFact> = {},
): EventFact {
  return { type, actorId, createdAt, ...extra };
}

function makeNotice(
  post: HiringPostFact,
  candidate: Person,
  kind: NoticeFact['kind'],
  toRecruiter: boolean,
  noticeTitle: string,
  body: string,
  createdAt: Date,
): NoticeFact {
  return {
    kind,
    recipientId: toRecruiter ? post.recruiterId : candidate.id,
    actorId: toRecruiter ? candidate.id : post.recruiterId,
    title: noticeTitle,
    body,
    forRecruiter: toRecruiter,
    createdAt,
  };
}

function buildCoverLetter(
  random: Random,
  candidate: Person,
  post: HiringPostFact,
  title: (code: string | null) => string,
): string {
  const shared = post.skills
    .filter((skill) => candidate.skills.includes(skill))
    .slice(0, 3);
  const sameOccupation = candidate.occupation === post.occupationCode;
  const opening = random.pick([
    `Hi, I'm ${firstName(candidate)}.`,
    `Hello, my name is ${candidate.name}.`,
    `Hi! ${firstName(candidate)} here.`,
  ]);
  const experience = `I have ${years(candidate.years)} of experience as a ${title(candidate.occupation)}`;
  const skills = shared.length
    ? `, and I use ${list(shared)} in my daily work.`
    : '.';
  const fit = sameOccupation
    ? `The ${post.title} role is close to what I do now.`
    : `I would like to move into ${title(post.occupationCode)} work, and much of what I do already overlaps.`;
  return `${opening} ${experience}${skills} ${fit} Happy to talk whenever suits you.`;
}

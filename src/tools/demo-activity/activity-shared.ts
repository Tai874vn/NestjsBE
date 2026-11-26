import type { HiringEventType } from '../../modules/hiring-pipeline/services/hiring-events.service';
import type {
  ContractFact,
  LedgerFact,
  ProposalFact,
  ServiceTerms,
  WalletFact,
} from './build-contracts';

export const LEVELS = ['Junior', 'Mid', 'Senior'] as const;
export type Level = (typeof LEVELS)[number];

export type Person = {
  id: number;
  name: string;
  kind: 'candidate' | 'recruiter';
  /** ESCO occupation code from the resume; null for recruiters. */
  occupation: string | null;
  /** The AI level of the resume; null when there is none. */
  level: Level | null;
  /** Years in the occupation (main years from the resume's jobs). */
  years: number;
  skills: string[];
  location: string;
  discoverable: boolean;
  company: string | null;
};

export type HiringPostFact = {
  id: number;
  recruiterId: number;
  title: string;
  occupationCode: string | null;
  level: Level | null;
  yearsRequired: number;
  skills: string[];
  location: string;
  employmentType: string;
};

export type ServiceFact = {
  id: number;
  creatorId: number;
  title: string;
  summary: string;
  description: string;
};

export type ActivityInput = {
  people: Person[];
  hiringPosts: HiringPostFact[];
  services: ServiceFact[];
  /** ESCO relatedness: code -> (other code -> overlap). */
  related: Map<string, Map<string, number>>;
  occupationTitle: (code: string) => string;
  now: Date;
  seed?: number;
  /** Length of every 3-day contract window in minutes (CONTRACT_GRACE_MINUTES); 4320 by default. */
  graceMinutes?: number;
};

export type ApplicationStatus =
  | 'APPLIED'
  | 'REVIEWING'
  | 'INTERVIEWING'
  | 'OFFERED'
  | 'HIRED'
  | 'REJECTED'
  | 'WITHDRAWN';

/** One interview round. An application has at most one that is still open (PROPOSED or SCHEDULED). */
export type InterviewFact = {
  round: number;
  mode: 'ONLINE' | 'ONSITE' | 'PHONE';
  durationMinutes: number;
  location: string | null;
  note: string | null;
  proposedTimes: Date[];
  scheduledAt: Date | null;
  status: 'PROPOSED' | 'SCHEDULED' | 'COMPLETED';
  createdById: number;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

/** One step in the history of an application. `interview` is the index in `interviews` it belongs to. */
export type EventFact = {
  type: HiringEventType;
  actorId: number;
  createdAt: Date;
  data?: Record<string, unknown>;
  interview?: number;
};

/** A notification for the latest step of an application (the seed turns it into a real notification). */
export type NoticeFact = {
  kind: 'received' | 'application' | 'interview';
  recipientId: number;
  actorId: number;
  title: string;
  body: string;
  forRecruiter: boolean;
  createdAt: Date;
};

export type Activity = {
  /** How many people each hiring post can hire: 2 when someone was hired, else 1. */
  openings: Map<number, number>;
  joinedAt: Map<number, Date>;
  hiringPostCreatedAt: Map<number, Date>;
  serviceCreatedAt: Map<number, Date>;
  connections: Array<{
    requesterId: number;
    recipientId: number;
    status: 'PENDING' | 'ACCEPTED';
    createdAt: Date;
    updatedAt: Date;
  }>;
  applications: Array<{
    hiringPostId: number;
    applicantId: number;
    status: ApplicationStatus;
    coverLetter: string;
    offerNote: string | null;
    offeredAt: Date | null;
    decidedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    interviews: InterviewFact[];
    events: EventFact[];
    notices: NoticeFact[];
  }>;
  feedPosts: Array<{
    authorId: number;
    content: string;
    createdAt: Date;
    likes: Array<{ userId: number; createdAt: Date }>;
    comments: Array<{
      authorId: number;
      content: string;
      createdAt: Date;
      replyTo?: number;
    }>;
    savedBy: Array<{ userId: number; createdAt: Date }>;
  }>;
  /**
   * Price, milestone template and work mode of the priced services: every service with a proposal
   * or contract, and about half of the others. The rest stay at price 0 (portfolio posts).
   */
  serviceTerms: Map<number, ServiceTerms>;
  /** Proposals in every state; an ACCEPTED one points at its contract. */
  proposals: ProposalFact[];
  contracts: ContractFact[];
  /** One wallet per seeded person, and its ledger rows (SEED first, then the moves in time order). */
  wallets: WalletFact[];
  ledger: LedgerFact[];
  savedJobs: Array<{ userId: number; jobId: number; createdAt: Date }>;
  chats: Array<{
    members: [number, number];
    createdAt: Date;
    messages: Array<{ senderId: number; content: string; createdAt: Date }>;
  }>;
};

export const DAY = 86_400_000;
export const HOUR = 3_600_000;
export const RELATED_FROM = 0.25;

/** A small seeded random generator (mulberry32), so every run with the same seed gives the same activity. */
export function randomGenerator(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    chance: (probability: number) => next() < probability,
    int: (min: number, max: number) =>
      min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T =>
      items[Math.floor(next() * items.length)],
    shuffle: <T>(items: readonly T[]): T[] => {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const other = Math.floor(next() * (index + 1));
        [copy[index], copy[other]] = [copy[other], copy[index]];
      }
      return copy;
    },
  };
}
export type Random = ReturnType<typeof randomGenerator>;

/** Shared lookups and random generator passed to each activity builder step. */
export type ActivityContext = {
  input: ActivityInput;
  random: Random;
  now: Date;
  related: ActivityInput['related'];
  people: Map<number, Person>;
  candidates: Person[];
  recruiters: Person[];
  postById: Map<number, HiringPostFact>;
  title: (code: string | null) => string;
  ago: (days: number) => Date;
};

/** How close two occupations are: 1 the same, the ESCO overlap when related, 0.3 the same ISCO unit group. */
export function occupationFit(
  first: string | null,
  second: string | null,
  related: ActivityInput['related'],
) {
  if (!first || !second) return 0;
  if (first === second) return 1;
  const overlap =
    related.get(first)?.get(second) ?? related.get(second)?.get(first) ?? 0;
  if (overlap >= RELATED_FROM) return overlap;
  return first.slice(0, 4) === second.slice(0, 4) ? 0.3 : 0;
}

export function levelGap(first: Level | null, second: Level | null) {
  if (!first || !second) return 1;
  return Math.abs(LEVELS.indexOf(first) - LEVELS.indexOf(second));
}

/**
 * How well a candidate fits a hiring post: the occupation fit, minus 0.3 per level step apart, minus 0.2 when
 * they have clearly fewer years than asked for. Candidates at 0.25 or more apply.
 */
export function applicationFit(
  candidate: Person,
  post: HiringPostFact,
  related: ActivityInput['related'],
) {
  const occupation = occupationFit(
    candidate.occupation,
    post.occupationCode,
    related,
  );
  if (occupation === 0) return 0;
  const shortOfYears = candidate.years < post.yearsRequired - 1 ? 0.2 : 0;
  return (
    occupation - 0.3 * levelGap(candidate.level, post.level) - shortOfYears
  );
}

export const firstName = (person: Person) => person.name.split(' ')[0];

export const years = (value: number) => {
  const rounded = Math.max(1, Math.round(value));
  return rounded === 1 ? '1 year' : `${rounded} years`;
};

export const list = (items: string[]) =>
  items.length <= 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

export const between = (random: Random, from: Date, to: Date) =>
  new Date(
    from.getTime() + random.next() * Math.max(0, to.getTime() - from.getTime()),
  );

export const after = (
  random: Random,
  from: Date,
  minHours: number,
  maxHours: number,
  cap: Date,
) =>
  new Date(
    Math.min(
      cap.getTime(),
      from.getTime() +
        (minHours + random.next() * (maxHours - minHours)) * HOUR,
    ),
  );

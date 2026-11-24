/**
 * Demo proposals, contracts and wallets for the seeded accounts (spec 4.8 and 4.10).
 *
 * In simple words: buildActivity picks who buys which service (a "pair": a client and a service). This
 * file gives each pair one story ("scenario"), so the site shows every state at least once:
 *   - proposals that are OPEN (the turn on each side, some with 2 or 3 versions), DECLINED, WITHDRAWN, EXPIRED;
 *   - ACTIVE contracts whose current milestone is PENDING, FUNDED, SUBMITTED or CHANGES_REQUESTED, one with
 *     each deadline warning already sent, one with an OPEN amendment (change request), one with an open
 *     end request;
 *   - COMPLETED contracts (about 70% reviewed) and ENDED ones with each end reason.
 * Every money step (fund, release, refund) is written to the ledger (the wallet history) in time order,
 * starting from the 5,000-credit SEED grant, so every balance is the running sum of its rows.
 *
 * Times: the steps people take are spread over days. The deadline rules use the 3-day window
 * (CONTRACT_GRACE_MINUTES, 4320 by default); ACTIVE contracts are placed so that the sweeper (the job that
 * applies the deadline rules every minute) has nothing to do with them at the seed's "now": the warned
 * ones already carry their warning flag and their window is still open.
 *
 * It is pure (same input -> same output, no database, no clock of its own) and fixed templates fill every
 * text; nothing is written by an AI model.
 */

import type {
  ContractEventType,
  EndReason,
} from '../../modules/contracts/contract-events.service';
import { fmtCredits } from '../../modules/contracts/contract-rules';
import type { DeadlineRule } from '../../modules/contracts/deadline-rules';
import type { Person, Random, ServiceFact } from './build-activity';

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** The starting grant of every wallet (WalletService STARTING_GRANT). */
export const STARTING_GRANT = 5000;
/** An OPEN proposal expires 7 days after its latest version (never shortened by the grace window). */
const PROPOSAL_LIFETIME = 7 * DAY;
const SYSTEM_NAME = 'JobAura';

export const SCENARIOS = [
  'open-v1',
  'open-v2',
  'open-v3',
  'declined',
  'withdrawn',
  'expired',
  'active-pending-first',
  'active-funded',
  'active-submitted',
  'active-changes',
  'active-pending-next',
  'active-late-warned',
  'active-silent-warned',
  'active-unfunded-warned',
  'active-open-amendment',
  'active-end-request',
  'completed',
  'ended-freelancer-late',
  'ended-client-silent',
  'ended-not-funded',
  'ended-mutual',
  'ended-client-ended',
] as const;
export type Scenario = (typeof SCENARIOS)[number];
type ContractScenario = Exclude<
  Scenario,
  'open-v1' | 'open-v2' | 'open-v3' | 'declined' | 'withdrawn' | 'expired'
>;

/** The first pairs get these, in this order, so every state shows up once. */
const REQUIRED: Scenario[] = [
  'open-v1',
  'open-v2',
  'open-v3',
  'declined',
  'withdrawn',
  'expired',
  'active-pending-first',
  'active-funded',
  'active-submitted',
  'active-changes',
  'active-pending-next',
  'active-late-warned',
  'active-silent-warned',
  'active-unfunded-warned',
  'active-open-amendment',
  'active-end-request',
  'completed',
  'completed',
  'completed',
  'ended-freelancer-late',
  'ended-client-silent',
  'ended-not-funded',
  'ended-mutual',
  'ended-client-ended',
];
/** The other pairs get a weighted random story (no second open amendment or end request). */
const EXTRA: Array<[Scenario, number]> = [
  ['completed', 34],
  ['active-funded', 8],
  ['active-submitted', 6],
  ['active-changes', 4],
  ['active-pending-first', 4],
  ['active-pending-next', 4],
  ['open-v1', 6],
  ['open-v2', 4],
  ['declined', 6],
  ['withdrawn', 3],
  ['expired', 4],
  ['ended-mutual', 4],
  ['ended-client-ended', 3],
  ['ended-freelancer-late', 3],
  ['ended-not-funded', 2],
  ['ended-client-silent', 2],
];

export type MilestoneStatusName =
  | 'PENDING'
  | 'FUNDED'
  | 'SUBMITTED'
  | 'CHANGES_REQUESTED'
  | 'APPROVED'
  | 'CANCELLED';
export type LedgerTypeName = 'SEED' | 'FUND_HOLD' | 'RELEASE' | 'REFUND';
export type Side = 'client' | 'freelancer';

export type DraftMilestone = {
  title: string;
  description: string | null;
  dueDate: Date;
  amount: number;
};

export type VersionFact = {
  number: number;
  authorId: number;
  brief: string;
  referenceLinks: string[];
  referenceImages: string[];
  deadline: Date;
  milestones: DraftMilestone[];
  total: number;
  createdAt: Date;
};

/**
 * One history row (ContractEvent). `position` is the milestone it is about: the seed puts that
 * milestone's id into data.milestoneId. `amendment` is the index in `amendments` (data.amendmentId).
 * `withProposal` rows belong to the proposal too (proposal_accepted, contract_started).
 */
export type ContractEventFact = {
  type: ContractEventType;
  actorId: number | null;
  createdAt: Date;
  data?: Record<string, unknown>;
  position?: number;
  amendment?: number;
  withProposal?: boolean;
};

/** The notification for the latest step (PROPOSAL_UPDATE or CONTRACT_UPDATE). */
export type ContractNoticeFact = {
  kind: 'proposal' | 'contract';
  step: ContractEventType;
  recipientId: number;
  actorId: number | null;
  actorName: string;
  recipientSide: Side;
  title: string;
  body: string;
  position?: number;
  createdAt: Date;
};

export type ProposalFact = {
  jobId: number;
  clientId: number;
  freelancerId: number;
  status: 'OPEN' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN' | 'EXPIRED';
  latestVersion: number;
  turnUserId: number | null;
  expiresAt: Date;
  declineNote: string | null;
  decidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  versions: VersionFact[];
  events: ContractEventFact[];
  notices: ContractNoticeFact[];
  /** Index in `contracts` when accepted. */
  contract: number | null;
};

export type SubmissionFact = {
  number: number;
  authorId: number;
  note: string;
  images: string[];
  links: string[];
  feedback: string | null;
  createdAt: Date;
};

export type MilestoneFact = {
  position: number;
  title: string;
  description: string | null;
  dueDate: Date;
  amount: number;
  status: MilestoneStatusName;
  fundedAt: Date | null;
  submittedAt: Date | null;
  changesRequestedAt: Date | null;
  approvedAt: Date | null;
  cancelledAt: Date | null;
  autoApproved: boolean;
  lateWarnedAt: Date | null;
  silentWarnedAt: Date | null;
  unfundedWarnedAt: Date | null;
  submissions: SubmissionFact[];
};

export type AmendmentFact = {
  proposerId: number;
  status: 'OPEN';
  note: string;
  deadline: Date | null;
  /** Moves a due date; the seed turns `position` into the milestone id. */
  changes: Array<{ op: 'move'; position: number; dueDate: Date }>;
  createdAt: Date;
};

export type ContractFact = {
  scenario: ContractScenario;
  /** Index in `proposals`. */
  proposal: number;
  jobId: number;
  clientId: number;
  freelancerId: number;
  title: string;
  brief: string;
  referenceLinks: string[];
  referenceImages: string[];
  deadline: Date;
  total: number;
  status: 'ACTIVE' | 'COMPLETED' | 'ENDED';
  endReason: EndReason | null;
  /** Always false: demo contracts are made the normal way, not imported from old hires. */
  imported: boolean;
  endRequestedById: number | null;
  endRequestNote: string | null;
  endRequestChoice: null;
  endRequestedAt: Date | null;
  completedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  milestones: MilestoneFact[];
  amendments: AmendmentFact[];
  events: ContractEventFact[];
  notices: ContractNoticeFact[];
  review: { content: string; rating: number; commentedAt: Date } | null;
};

export type WalletFact = {
  userId: number;
  available: number;
  held: number;
  createdAt: Date;
  updatedAt: Date;
};

/** One ledger row. `contract` is the index in `contracts`, `position` the milestone. */
export type LedgerFact = {
  userId: number;
  type: LedgerTypeName;
  availableDelta: number;
  heldDelta: number;
  availableAfter: number;
  heldAfter: number;
  contract: number | null;
  position: number | null;
  counterpartyId: number | null;
  createdAt: Date;
};

export type ChatLineFact = {
  fromId: number;
  toId: number;
  text: string;
  createdAt: Date;
};

export type ContractPair = {
  client: Person;
  service: ServiceFact;
  freelancer: Person;
  /** Nothing of this pair may happen before this (the service exists and the client has joined). */
  earliest: Date;
};

/**
 * What a priced service offers: its price in credits, the split the seller suggests
 * (milestoneTemplate, shares add to 100) and where the work happens.
 */
export type ServiceTerms = {
  price: number;
  milestoneTemplate: Array<{ title: string; share: number }>;
  workMode: 'REMOTE' | 'ONSITE' | 'BOTH';
  /** The area the seller covers for onsite work; null when REMOTE. */
  serviceArea: string | null;
};

export type ContractsInput = {
  pairs: ContractPair[];
  /** The terms of every priced service; each pair's service is in it. */
  terms: Map<number, ServiceTerms>;
  people: Person[];
  joinedAt: Map<number, Date>;
  now: Date;
  graceMinutes: number;
  random: Random;
  /** A fresh generator for a seed, so a story can be re-run with shorter gaps and the same draws. */
  makeRandom: (seed: number) => Random;
  review: (
    random: Random,
    freelancer: Person,
    service: ServiceFact,
  ) => { content: string; rating: number };
};

export type ContractsOutput = {
  proposals: ProposalFact[];
  contracts: ContractFact[];
  wallets: WalletFact[];
  ledger: LedgerFact[];
  chatLines: ChatLineFact[];
};

const firstName = (person: Person) => person.name.split(' ')[0];
const at = (ms: number) => new Date(ms);

const AMOUNTS: Record<string, [number, number]> = {
  Junior: [150, 500],
  Mid: [300, 900],
  Senior: [500, 1500],
};
/** Template titles by kind of work and number of rows (2 to 4). */
const TEMPLATE_TITLES: Record<WorkField, Record<number, string[]>> = {
  art: {
    2: ['Sketch', 'Final artwork'],
    3: ['Sketch', 'Color', 'Final'],
    4: ['Sketch', 'Line art', 'Color', 'Final'],
  },
  web: {
    2: ['Design', 'Build and launch'],
    3: ['Design', 'Build', 'Launch'],
    4: ['Design', 'Build', 'Test', 'Launch'],
  },
  generic: {
    2: ['Draft', 'Final'],
    3: ['Plan', 'Draft', 'Final'],
    4: ['Plan', 'Draft', 'Review', 'Final'],
  },
};
/** Share splits (percent, each adds to 100) by number of rows. */
const SHARES: Record<number, number[][]> = {
  2: [
    [40, 60],
    [50, 50],
  ],
  3: [
    [30, 40, 30],
    [20, 50, 30],
  ],
  4: [
    [20, 30, 30, 20],
    [25, 25, 25, 25],
  ],
};
type WorkField = 'art' | 'web' | 'generic';
/** ISCO unit groups (the first 4 digits of the ESCO code) for design and art work. */
const ART_UNITS = ['2163', '2166', '2651', '3432'];

/** The kind of work from the freelancer's occupation: design/art, software/web, or anything else. */
function fieldOf(occupation: string | null): WorkField {
  const unit = occupation?.slice(0, 4) ?? '';
  if (ART_UNITS.includes(unit)) return 'art';
  if (unit.startsWith('25') || unit.startsWith('351')) return 'web';
  return 'generic';
}

/**
 * Terms for one priced service: 2 to 4 template rows that fit the freelancer's field, a price from
 * the freelancer's level (the per-milestone scale times the rows, rounded to 50), and mostly REMOTE
 * work (a few BOTH or ONSITE, with the freelancer's location as the area).
 */
export function serviceTermsFor(
  random: Random,
  freelancer: Person,
): ServiceTerms {
  const rows = random.int(2, 4);
  const titles = TEMPLATE_TITLES[fieldOf(freelancer.occupation)][rows];
  const shares = random.pick(SHARES[rows]);
  const [low, high] = AMOUNTS[freelancer.level ?? 'Mid'];
  const price = Math.max(
    50,
    Math.round(((low + random.next() * (high - low)) * rows) / 50) * 50,
  );
  const roll = random.next();
  const workMode = roll < 0.8 ? 'REMOTE' : roll < 0.92 ? 'BOTH' : 'ONSITE';
  return {
    price,
    milestoneTemplate: titles.map((title, i) => ({ title, share: shares[i] })),
    workMode,
    serviceArea: workMode === 'REMOTE' ? null : freelancer.location,
  };
}

/**
 * The price split by the shares, in whole credits (each at least 1); what is left from rounding
 * down goes to the last milestone, so the amounts add up to the price.
 */
export function priceSplit(price: number, shares: number[]): number[] {
  const amounts = shares.map((share) =>
    Math.max(1, Math.floor((price * share) / 100)),
  );
  amounts[amounts.length - 1] += price - amounts.reduce((a, b) => a + b, 0);
  return amounts;
}
const SUBMIT_NOTES = [
  (title: string) =>
    `${title} is ready. The main points are in the notes; tell me if anything is unclear.`,
  (title: string) =>
    `Here is ${title.toLowerCase()}. I followed the brief and listed what I changed.`,
];
const RESUBMIT_NOTES = [
  (title: string) =>
    `Updated ${title.toLowerCase()} with the changes you asked for.`,
  () => 'Fixed the points from your note. Please have another look.',
];
const CHANGE_NOTES = [
  'Please make the main part clearer and fix the small issues we listed.',
  'Close, but the second half does not match the brief yet. Could you rework it?',
  'Looks good overall; please tidy the details before we approve.',
];
const DECLINE_NOTES = [
  'The dates do not work for me this month.',
  'The budget is lower than this work needs.',
  null,
];
const END_NOTES = [
  'Our plans changed, so we would like to stop here.',
  'We agreed in chat to stop after this step.',
];

export function buildContracts(input: ContractsInput): ContractsOutput {
  const { now, random } = input;
  const nowMs = now.getTime();
  const G = input.graceMinutes * MINUTE;
  // The day-2 warning comes at two thirds of the window (deadline-rules.ts ruleClock).
  const warnAfter = Math.round((input.graceMinutes * 2) / 3) * MINUTE;
  const proposals: ProposalFact[] = [];
  const contracts: ContractFact[] = [];
  const chatLines: ChatLineFact[] = [];
  /** The credits each client may still put on milestones, so `available` never goes below 0. */
  const budget = new Map<number, number>();
  /** Money moves, turned into ledger rows at the end in time order. */
  const moves: Array<{
    at: number;
    type: 'FUND_HOLD' | 'RELEASE' | 'REFUND';
    contract: number;
    position: number;
    amount: number;
  }> = [];

  const extraTotal = EXTRA.reduce((sum, [, weight]) => sum + weight, 0);
  const extra = (): Scenario => {
    let roll = random.next() * extraTotal;
    for (const [scenario, weight] of EXTRA) {
      roll -= weight;
      if (roll < 0) return scenario;
    }
    return 'completed';
  };

  for (const [index, pair] of input.pairs.entries()) {
    let scenario = index < REQUIRED.length ? REQUIRED[index] : extra();
    const { client, freelancer, service } = pair;
    // The milestones follow the service's template: its titles, and its price split by the shares.
    const template = input.terms.get(service.id)!.milestoneTemplate;
    const n = template.length;
    let amounts = priceSplit(
      input.terms.get(service.id)!.price,
      template.map((row) => row.share),
    );
    const k = currentPosition(scenario, n, random);
    // Scale the amounts down when the client cannot pay for every milestone this story funds.
    const funded = fundedPositions(scenario, n, k);
    const left = budget.get(client.id) ?? STARTING_GRANT;
    const need = amounts
      .filter((_, i) => funded.includes(i + 1))
      .reduce((sum, value) => sum + value, 0);
    if (need > left) {
      const factor = left / need;
      amounts = amounts.map((value) => Math.max(1, Math.floor(value * factor)));
    }
    const needNow = amounts
      .filter((_, i) => funded.includes(i + 1))
      .reduce((sum, value) => sum + value, 0);
    if (needNow > left) scenario = 'declined';
    const story: Story = {
      pair,
      n,
      k,
      amounts,
      titles: template.map((row) => row.title),
      brief: briefOf(random, client, freelancer, service, n),
      versions: random.pick([1, 1, 1, 2, 2, 3]),
    };

    if (isProposalOnly(scenario)) {
      proposals.push(proposalOnly(scenario, story, random, nowMs, chatLines));
      continue;
    }
    const built = contractStory(scenario, story, {
      random,
      makeRandom: input.makeRandom,
      nowMs,
      G,
      warnAfter,
      review: input.review,
    });
    if (!built) {
      // The story did not fit before "now" (a very long grace window): a declined proposal instead.
      proposals.push(proposalOnly('declined', story, random, nowMs, chatLines));
      continue;
    }
    budget.set(client.id, left - needNow);
    const contractIndex = contracts.length;
    built.proposal.contract = contractIndex;
    built.contract.proposal = proposals.length;
    proposals.push(built.proposal);
    contracts.push(built.contract);
    chatLines.push(...built.chatLines);
    for (const move of built.moves)
      moves.push({ ...move, contract: contractIndex });
  }

  // Wallets: every seeded person gets the SEED grant when they joined; then each move in time order.
  type Row = Omit<LedgerFact, 'availableAfter' | 'heldAfter'> & { seq: number };
  const rows: Row[] = [];
  for (const person of input.people) {
    rows.push({
      userId: person.id,
      type: 'SEED',
      availableDelta: STARTING_GRANT,
      heldDelta: 0,
      contract: null,
      position: null,
      counterpartyId: null,
      createdAt: input.joinedAt.get(person.id) ?? now,
      seq: rows.length,
    });
  }
  for (const move of moves) {
    const c = contracts[move.contract];
    const link = { contract: move.contract, position: move.position };
    const createdAt = at(move.at);
    if (move.type === 'FUND_HOLD') {
      rows.push({
        userId: c.clientId,
        type: 'FUND_HOLD',
        availableDelta: -move.amount,
        heldDelta: move.amount,
        counterpartyId: c.freelancerId,
        createdAt,
        seq: rows.length,
        ...link,
      });
    } else if (move.type === 'RELEASE') {
      rows.push({
        userId: c.clientId,
        type: 'RELEASE',
        availableDelta: 0,
        heldDelta: -move.amount,
        counterpartyId: c.freelancerId,
        createdAt,
        seq: rows.length,
        ...link,
      });
      rows.push({
        userId: c.freelancerId,
        type: 'RELEASE',
        availableDelta: move.amount,
        heldDelta: 0,
        counterpartyId: c.clientId,
        createdAt,
        seq: rows.length,
        ...link,
      });
    } else {
      rows.push({
        userId: c.clientId,
        type: 'REFUND',
        availableDelta: move.amount,
        heldDelta: -move.amount,
        counterpartyId: c.freelancerId,
        createdAt,
        seq: rows.length,
        ...link,
      });
    }
  }
  rows.sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.seq - b.seq,
  );
  const balance = new Map<number, { available: number; held: number }>();
  const ledger: LedgerFact[] = rows.map((row) => {
    const wallet = balance.get(row.userId) ?? { available: 0, held: 0 };
    wallet.available += row.availableDelta;
    wallet.held += row.heldDelta;
    if (wallet.available < 0 || wallet.held < 0) {
      // A bug in this builder: the database CHECKs would refuse the row anyway.
      throw new Error(
        `Wallet ${row.userId} would go below 0 at ${row.createdAt.toISOString()}.`,
      );
    }
    balance.set(row.userId, wallet);
    return {
      userId: row.userId,
      type: row.type,
      availableDelta: row.availableDelta,
      heldDelta: row.heldDelta,
      availableAfter: wallet.available,
      heldAfter: wallet.held,
      contract: row.contract,
      position: row.position,
      counterpartyId: row.counterpartyId,
      createdAt: row.createdAt,
    };
  });
  const wallets: WalletFact[] = input.people.map((person) => {
    const mine = ledger.filter((row) => row.userId === person.id);
    return {
      userId: person.id,
      available: mine.at(-1)!.availableAfter,
      held: mine.at(-1)!.heldAfter,
      createdAt: mine[0].createdAt,
      updatedAt: mine.at(-1)!.createdAt,
    };
  });

  return { proposals, contracts, wallets, ledger, chatLines };
}

type Story = {
  pair: ContractPair;
  n: number;
  /** The current milestone (1-based): the one the story stops on. */
  k: number;
  amounts: number[];
  titles: string[];
  brief: string;
  versions: number;
};

function isProposalOnly(
  scenario: Scenario,
): scenario is Exclude<Scenario, ContractScenario> {
  return [
    'open-v1',
    'open-v2',
    'open-v3',
    'declined',
    'withdrawn',
    'expired',
  ].includes(scenario);
}

function currentPosition(scenario: Scenario, n: number, random: Random) {
  if (scenario === 'active-pending-first') return 1;
  if (
    [
      'active-pending-next',
      'active-unfunded-warned',
      'ended-not-funded',
    ].includes(scenario)
  )
    return random.int(2, n);
  if (scenario === 'ended-client-silent') return random.int(1, n - 1);
  return random.int(1, n);
}

/** Which milestones get credits held (FUND_HOLD) in the story. */
function fundedPositions(scenario: Scenario, n: number, k: number): number[] {
  const upTo = (last: number) =>
    Array.from({ length: Math.max(0, last) }, (_, i) => i + 1);
  if (isProposalOnly(scenario)) return [];
  if (scenario === 'completed') return upTo(n);
  if (
    [
      'active-pending-first',
      'active-pending-next',
      'active-unfunded-warned',
      'ended-not-funded',
      'ended-client-ended',
    ].includes(scenario)
  )
    return upTo(k - 1);
  return upTo(k);
}

function briefOf(
  random: Random,
  client: Person,
  freelancer: Person,
  service: ServiceFact,
  n: number,
) {
  const owner = client.company ? `the ${client.company} team` : 'my project';
  return random.pick([
    `Hi ${firstName(freelancer)}, I would like "${service.title}" for ${owner}. I split the work into ${n === 1 ? 'one milestone' : `${n} milestones`}; tell me if the dates do not suit you.`,
    `We need help with "${service.title}" for ${owner}. Please follow the milestones below and share progress in chat.`,
  ]);
}

/** The amounts of each version: the client starts lower, the freelancer counters, the last one is agreed. */
function versionAmounts(amounts: number[], count: number, number: number) {
  const factors: Record<number, number[]> = {
    1: [1],
    2: [0.85, 1],
    3: [0.8, 1.1, 1],
  };
  const factor = factors[count][number - 1];
  return amounts.map((value) =>
    factor === 1 ? value : Math.max(1, Math.round(value * factor)),
  );
}

function makeVersions(
  story: Story,
  times: number[],
  dues: Date[],
  deadline: Date,
): VersionFact[] {
  const { client, freelancer } = story.pair;
  return times.map((time, i) => {
    const amounts = versionAmounts(story.amounts, times.length, i + 1);
    const milestones = amounts.map((amount, m) => ({
      title: story.titles[m],
      description: null,
      dueDate: dues[m],
      amount,
    }));
    return {
      number: i + 1,
      // The client sends version 1; the sides take turns after that.
      authorId: i % 2 === 0 ? client.id : freelancer.id,
      brief: story.brief,
      referenceLinks: [],
      referenceImages: [],
      deadline,
      milestones,
      total: amounts.reduce((sum, value) => sum + value, 0),
      createdAt: at(time),
    };
  });
}

/** History rows and chat lines of the versions (sent, then countered). */
function versionSteps(
  versions: VersionFact[],
  story: Story,
  chatLines: ChatLineFact[],
): ContractEventFact[] {
  const { client, freelancer, service } = story.pair;
  return versions.map((v) => {
    const toId = v.authorId === client.id ? freelancer.id : client.id;
    chatLines.push({
      fromId: v.authorId,
      toId,
      createdAt: v.createdAt,
      text:
        v.number === 1
          ? `I sent a proposal for "${service.title}": ${fmtCredits(v.total)} credits in ${v.milestones.length === 1 ? '1 milestone' : `${v.milestones.length} milestones`}.`
          : `I sent version ${v.number} of the proposal for "${service.title}": ${fmtCredits(v.total)} credits.`,
    });
    return v.number === 1
      ? {
          type: 'proposal_sent' as const,
          actorId: v.authorId,
          createdAt: v.createdAt,
          data: { version: 1, total: v.total },
        }
      : {
          type: 'proposal_countered' as const,
          actorId: v.authorId,
          createdAt: v.createdAt,
          data: { version: v.number, total: v.total },
        };
  });
}

/** Version times going back from the latest one (each answer within the 7 days). */
function versionTimes(random: Random, latest: number, count: number) {
  const times = [latest];
  while (times.length < count)
    times.unshift(times[0] - (0.3 + random.next() * 2) * DAY);
  return times;
}

function proposalOnly(
  scenario: Scenario,
  story: Story,
  random: Random,
  nowMs: number,
  chatLines: ChatLineFact[],
): ProposalFact {
  const { client, freelancer, service } = story.pair;
  const name = (id: number) =>
    id === client.id ? client.name : freelancer.name;
  const count =
    scenario === 'open-v1'
      ? 1
      : scenario === 'open-v2'
        ? 2
        : scenario === 'open-v3'
          ? 3
          : Math.min(2, story.versions);
  const latest =
    scenario === 'expired'
      ? nowMs - (8 + random.next() * 10) * DAY
      : scenario.startsWith('open')
        ? nowMs - (0.1 + random.next() * 5) * DAY
        : nowMs - (4 + random.next() * 14) * DAY;
  const times = versionTimes(random, latest, count);
  // An OPEN proposal's first due date is in the future, so the other side can still accept it.
  const base = scenario.startsWith('open') ? nowMs : latest;
  const dues: Date[] = [];
  let due = base;
  for (let i = 0; i < story.n; i += 1) {
    due += (3 + random.next() * 3) * DAY;
    dues.push(at(due));
  }
  const deadline = at(due + random.next() * 2 * DAY);
  const versions = makeVersions(story, times, dues, deadline);
  const last = versions.at(-1)!;
  const otherOf = (id: number) =>
    id === client.id ? freelancer.id : client.id;
  const turn = otherOf(last.authorId);
  const events = versionSteps(versions, story, chatLines);
  const proposal: ProposalFact = {
    jobId: service.id,
    clientId: client.id,
    freelancerId: freelancer.id,
    status: 'OPEN',
    latestVersion: count,
    turnUserId: turn,
    expiresAt: at(latest + PROPOSAL_LIFETIME),
    declineNote: null,
    decidedAt: null,
    createdAt: versions[0].createdAt,
    updatedAt: last.createdAt,
    versions,
    events,
    notices: [],
    contract: null,
  };
  const sideOf = (id: number): Side =>
    id === client.id ? 'client' : 'freelancer';
  const notice = (
    step: ContractEventType,
    actorId: number | null,
    recipientId: number,
    title: string,
    body: string,
    createdAt: Date,
  ): ContractNoticeFact => ({
    kind: 'proposal',
    step,
    recipientId,
    actorId,
    actorName: actorId === null ? SYSTEM_NAME : name(actorId),
    recipientSide: sideOf(recipientId),
    title,
    body,
    createdAt,
  });

  if (scenario.startsWith('open')) {
    proposal.notices.push(
      count === 1
        ? notice(
            'proposal_sent',
            client.id,
            freelancer.id,
            'New proposal',
            `${client.name} sent a proposal for ${service.title} (${fmtCredits(last.total)} credits).`,
            last.createdAt,
          )
        : notice(
            'proposal_countered',
            last.authorId,
            turn,
            'Counter-offer',
            `${name(last.authorId)} sent version ${count} for ${service.title} (${fmtCredits(last.total)} credits).`,
            last.createdAt,
          ),
    );
    return proposal;
  }

  const decidedAt =
    scenario === 'expired'
      ? at(latest + PROPOSAL_LIFETIME + MINUTE)
      : at(latest + (0.1 + random.next() * 3) * DAY);
  Object.assign(proposal, {
    turnUserId: null,
    decidedAt,
    updatedAt: decidedAt,
  });
  if (scenario === 'declined') {
    const note = random.pick(DECLINE_NOTES);
    proposal.status = 'DECLINED';
    proposal.declineNote = note;
    events.push({
      type: 'proposal_declined',
      actorId: turn,
      createdAt: decidedAt,
      data: note ? { note } : {},
    });
    proposal.notices.push(
      notice(
        'proposal_declined',
        turn,
        last.authorId,
        'Proposal declined',
        `${name(turn)} declined the proposal for ${service.title}.${note ? ` Note: ${note}` : ''}`,
        decidedAt,
      ),
    );
  } else if (scenario === 'withdrawn') {
    proposal.status = 'WITHDRAWN';
    events.push({
      type: 'proposal_withdrawn',
      actorId: last.authorId,
      createdAt: decidedAt,
    });
    proposal.notices.push(
      notice(
        'proposal_withdrawn',
        last.authorId,
        turn,
        'Proposal withdrawn',
        `${name(last.authorId)} withdrew the proposal for ${service.title}.`,
        decidedAt,
      ),
    );
  } else {
    proposal.status = 'EXPIRED';
    events.push({
      type: 'proposal_expired',
      actorId: null,
      createdAt: decidedAt,
    });
    proposal.notices.push(
      notice(
        'proposal_expired',
        null,
        client.id,
        'Proposal expired',
        `The proposal for ${service.title} expired after 7 days without an answer.`,
        decidedAt,
      ),
    );
  }
  return proposal;
}

// ---------------------------------------------------------------------------------------------
// Contract stories. They are first played on a clock that starts at 0 (the accept), then moved
// ("shifted") so the step that matters lands at the right moment before "now".
// ---------------------------------------------------------------------------------------------

type SimMilestone = {
  status: MilestoneStatusName;
  amount: number;
  fundedAt?: number;
  submittedAt?: number;
  changesRequestedAt?: number;
  approvedAt?: number;
  cancelledAt?: number;
  autoApproved: boolean;
  lateWarnedAt?: number;
  silentWarnedAt?: number;
  unfundedWarnedAt?: number;
  submissions: Array<{ at: number; note: string; feedback: string | null }>;
  /** A due date the story needs (the late rule counts from it). */
  fixedDue?: number;
};
type SimEvent = Omit<ContractEventFact, 'createdAt'> & { at: number };
type SimMove = {
  at: number;
  type: 'FUND_HOLD' | 'RELEASE' | 'REFUND';
  position: number;
  amount: number;
};

type StoryContext = {
  random: Random;
  makeRandom: (seed: number) => Random;
  nowMs: number;
  G: number;
  warnAfter: number;
  review: ContractsInput['review'];
};

function contractStory(
  scenario: ContractScenario,
  story: Story,
  ctx: StoryContext,
): {
  proposal: ProposalFact;
  contract: ContractFact;
  moves: SimMove[];
  chatLines: ChatLineFact[];
} | null {
  const { random, nowMs, G, warnAfter } = ctx;
  const { earliest } = story.pair;
  // Where the key step lands (drawn once, so a re-run with shorter gaps keeps the same aim).
  const recentHuman = (0.1 + random.next() * 1.4) * DAY;
  const insideWarn = (0.1 + random.next() * 0.8) * 0.6 * G;
  const afterWarn = warnAfter + (0.2 + random.next() * 0.6) * (G - warnAfter);
  const finishedAgo = (0.5 + random.next() * 14) * DAY;
  const seed = random.int(1, 2_000_000_000);

  let pace = 1;
  for (let tries = 0; tries < 10; tries += 1, pace *= 0.7) {
    const sim = play(scenario, story, ctx.makeRandom(seed), pace, G, warnAfter);
    const lastAt = Math.max(...sim.events.map((e) => e.at));
    let shift: number;
    if (sim.anchor === null) {
      // Finished: it ended some days ago, but not before the pair could start.
      shift = nowMs - finishedAgo - lastAt;
      if (shift + sim.firstAt < earliest.getTime())
        shift = earliest.getTime() - sim.firstAt;
      if (shift + lastAt > nowMs - HOUR) continue;
    } else {
      const target =
        sim.anchorKind === 'human'
          ? nowMs - recentHuman
          : sim.anchorKind === 'inside-warn'
            ? nowMs - insideWarn
            : nowMs - afterWarn;
      shift = target - sim.anchor;
      if (shift + sim.firstAt < earliest.getTime()) continue;
    }
    return finish(scenario, story, sim, shift, ctx);
  }
  return null;
}

type Played = {
  ms: SimMilestone[];
  events: SimEvent[];
  moves: SimMove[];
  status: ContractFact['status'];
  endReason: EndReason | null;
  completedAt?: number;
  endedAt?: number;
  /** The relative time that must land at the target, or null for a finished story. */
  anchor: number | null;
  anchorKind: 'human' | 'inside-warn' | 'after-warn';
  /** Times of the proposal versions (before the accept at 0). */
  versionAt: number[];
  accepterId: number;
  firstAt: number;
  endRequest?: { by: number; note: string };
};

function play(
  scenario: ContractScenario,
  story: Story,
  random: Random,
  pace: number,
  G: number,
  warnAfter: number,
): Played {
  const { client, freelancer } = story.pair;
  const gap = (min: number, max: number) =>
    (min + random.next() * (max - min)) * DAY * pace;
  const ms: SimMilestone[] = story.amounts.map((amount) => ({
    status: 'PENDING',
    amount,
    autoApproved: false,
    submissions: [],
  }));
  const events: SimEvent[] = [];
  const moves: SimMove[] = [];
  const state: Pick<
    Played,
    'status' | 'endReason' | 'completedAt' | 'endedAt'
  > = {
    status: 'ACTIVE',
    endReason: null,
  };
  let t = 0;

  // The versions came before the accept; the side that did not send the latest one accepts it.
  const versionAt = [-gap(0.2, 2)];
  while (versionAt.length < story.versions)
    versionAt.unshift(versionAt[0] - gap(0.3, 2.3));
  const lastAuthor = (story.versions - 1) % 2 === 0 ? client.id : freelancer.id;
  const accepterId = lastAuthor === client.id ? freelancer.id : client.id;
  const total = story.amounts.reduce((sum, value) => sum + value, 0);
  const ev = (
    type: ContractEventType,
    actorId: number | null,
    data?: Record<string, unknown>,
    position?: number,
  ) => events.push({ type, actorId, at: t, data, position });
  events.push(
    {
      type: 'proposal_accepted',
      actorId: accepterId,
      at: 0,
      data: { version: story.versions },
      withProposal: true,
    },
    {
      type: 'contract_started',
      actorId: accepterId,
      at: 0,
      data: { total },
      withProposal: true,
    },
  );

  const NO_WARNINGS = {
    lateWarnedAt: undefined,
    silentWarnedAt: undefined,
    unfundedWarnedAt: undefined,
  };
  const fund = (p: number) => {
    const m = ms[p - 1];
    Object.assign(m, { status: 'FUNDED', fundedAt: t });
    moves.push({ at: t, type: 'FUND_HOLD', position: p, amount: m.amount });
    ev('milestone_funded', client.id, { position: p, amount: m.amount }, p);
  };
  const submit = (p: number) => {
    const m = ms[p - 1];
    const title = story.titles[p - 1];
    const note = m.submissions.length
      ? random.pick(RESUBMIT_NOTES)(title)
      : random.pick(SUBMIT_NOTES)(title);
    m.submissions.push({ at: t, note, feedback: null });
    Object.assign(m, { status: 'SUBMITTED', submittedAt: t, ...NO_WARNINGS });
    ev(
      'work_submitted',
      freelancer.id,
      { position: p, submission: m.submissions.length },
      p,
    );
  };
  const changes = (p: number) => {
    const m = ms[p - 1];
    const note = random.pick(CHANGE_NOTES);
    m.submissions.at(-1)!.feedback = note;
    Object.assign(m, {
      status: 'CHANGES_REQUESTED',
      changesRequestedAt: t,
      ...NO_WARNINGS,
    });
    ev('changes_requested', client.id, { position: p, note }, p);
  };
  const approve = (p: number, auto: boolean) => {
    const m = ms[p - 1];
    moves.push({ at: t, type: 'RELEASE', position: p, amount: m.amount });
    Object.assign(m, { status: 'APPROVED', approvedAt: t, autoApproved: auto });
    const actor = auto ? null : client.id;
    ev('milestone_approved', actor, { position: p, amount: m.amount, auto }, p);
    if (ms.every((x) => x.status === 'APPROVED' || x.status === 'CANCELLED')) {
      Object.assign(state, { status: 'COMPLETED', completedAt: t });
      ev('contract_completed', actor);
    }
  };
  const warn = (p: number, rule: DeadlineRule) => {
    const m = ms[p - 1];
    if (rule === 'FREELANCER_LATE') m.lateWarnedAt = t;
    else if (rule === 'CLIENT_SILENT') m.silentWarnedAt = t;
    else m.unfundedWarnedAt = t;
    ev('warning_sent', null, { rule, position: p }, p);
  };
  // Ending, the way ContractEndingService.end does it: held credits back to the client, the rest cancelled.
  const end = (reason: EndReason, actorId: number | null) => {
    for (const [i, m] of ms.entries()) {
      const p = i + 1;
      if (['FUNDED', 'SUBMITTED', 'CHANGES_REQUESTED'].includes(m.status)) {
        moves.push({ at: t, type: 'REFUND', position: p, amount: m.amount });
        Object.assign(m, { status: 'CANCELLED', cancelledAt: t });
        ev('milestone_refunded', actorId, { position: p, amount: m.amount }, p);
      } else if (m.status === 'PENDING') {
        Object.assign(m, { status: 'CANCELLED', cancelledAt: t });
        ev('milestone_cancelled', actorId, { position: p }, p);
      }
    }
    Object.assign(state, { status: 'ENDED', endReason: reason, endedAt: t });
    ev('contract_ended', actorId, { reason });
  };
  // One milestone from funding to approval, sometimes with one round of changes.
  const work = (p: number) => {
    t += gap(0.1, 1);
    fund(p);
    t += gap(1, 3);
    submit(p);
    if (random.chance(0.35)) {
      t += gap(0.2, 1.2);
      changes(p);
      t += gap(0.5, 2);
      submit(p);
    }
    t += gap(0.2, 1.2);
    approve(p, false);
  };
  const doneBefore = (p: number) => {
    for (let i = 1; i < p; i += 1) work(i);
  };

  const { k, n } = story;
  let anchor: number | null = null;
  let anchorKind: Played['anchorKind'] = 'human';
  let endRequest: Played['endRequest'];
  switch (scenario) {
    case 'completed':
      for (let p = 1; p <= n; p += 1) work(p);
      break;
    case 'active-pending-first':
      anchor = 0;
      anchorKind = 'inside-warn';
      break;
    case 'active-funded':
    case 'active-open-amendment':
    case 'active-end-request':
      doneBefore(k);
      t += gap(0.1, 1);
      fund(k);
      anchor = t;
      break;
    case 'active-submitted':
      doneBefore(k);
      t += gap(0.1, 1);
      fund(k);
      if (random.chance(0.4)) {
        t += gap(1, 3);
        submit(k);
        t += gap(0.2, 1.2);
        changes(k);
      }
      t += gap(1, 3);
      submit(k);
      anchor = t;
      anchorKind = 'inside-warn';
      break;
    case 'active-changes':
      doneBefore(k);
      t += gap(0.1, 1);
      fund(k);
      t += gap(1, 3);
      submit(k);
      t += gap(0.2, 1.2);
      changes(k);
      anchor = t;
      break;
    case 'active-pending-next':
      doneBefore(k);
      anchor = t;
      anchorKind = 'inside-warn';
      break;
    case 'active-late-warned': {
      doneBefore(k);
      t += gap(0.1, 1);
      fund(k);
      t += gap(1, 3);
      ms[k - 1].fixedDue = t;
      anchor = t;
      anchorKind = 'inside-warn';
      // The late warning goes out as soon as the due date has passed (the next sweeper pass).
      t += Math.min(MINUTE, 0.05 * G);
      warn(k, 'FREELANCER_LATE');
      break;
    }
    case 'active-silent-warned':
      doneBefore(k);
      t += gap(0.1, 1);
      fund(k);
      t += gap(1, 3);
      submit(k);
      anchor = t;
      anchorKind = 'after-warn';
      t += warnAfter;
      warn(k, 'CLIENT_SILENT');
      break;
    case 'active-unfunded-warned':
      doneBefore(k);
      anchor = t;
      anchorKind = 'after-warn';
      t += warnAfter;
      warn(k, 'NOT_FUNDED');
      break;
    case 'ended-freelancer-late': {
      doneBefore(k);
      t += gap(0.1, 1);
      fund(k);
      t += gap(1, 3);
      const due = t;
      ms[k - 1].fixedDue = due;
      t += Math.min(MINUTE, 0.05 * G);
      warn(k, 'FREELANCER_LATE');
      t = due + G;
      end('FREELANCER_LATE', null);
      break;
    }
    case 'ended-client-silent': {
      doneBefore(k);
      t += gap(0.1, 1);
      fund(k);
      t += gap(1, 3);
      submit(k);
      const submitted = t;
      t = submitted + warnAfter;
      warn(k, 'CLIENT_SILENT');
      t = submitted + G;
      approve(k, true);
      end('CLIENT_SILENT', null);
      break;
    }
    case 'ended-not-funded': {
      doneBefore(k);
      const approved = t;
      t = approved + warnAfter;
      warn(k, 'NOT_FUNDED');
      t = approved + G;
      end('NOT_FUNDED', null);
      break;
    }
    case 'ended-mutual': {
      doneBefore(k);
      t += gap(0.1, 1);
      fund(k);
      t += gap(0.5, 2);
      const by = random.chance(0.5) ? client.id : freelancer.id;
      const note = random.pick(END_NOTES);
      ev('end_requested', by, { note });
      t += gap(0.2, 1);
      end('MUTUAL', by === client.id ? freelancer.id : client.id);
      break;
    }
    case 'ended-client-ended':
      doneBefore(k);
      // Before the day-2 "fund the next milestone" warning.
      t += Math.min(gap(0.1, 1), 0.5 * warnAfter);
      end('CLIENT_ENDED', client.id);
      break;
  }
  if (scenario === 'active-end-request') {
    endRequest = {
      by: random.chance(0.5) ? client.id : freelancer.id,
      note: random.pick(END_NOTES),
    };
  }
  return {
    ms,
    events,
    moves,
    ...state,
    anchor,
    anchorKind,
    versionAt,
    accepterId,
    firstAt: versionAt[0],
    endRequest,
  };
}

function finish(
  scenario: ContractScenario,
  story: Story,
  sim: Played,
  shift: number,
  ctx: StoryContext,
) {
  const { random, nowMs } = ctx;
  const { client, freelancer, service } = story.pair;
  const abs = (value: number | undefined) =>
    value === undefined ? null : at(value + shift);
  const acceptedAt = at(shift);
  const endAt =
    sim.status === 'COMPLETED'
      ? sim.completedAt! + shift
      : sim.status === 'ENDED'
        ? sim.endedAt! + shift
        : null;

  // Due dates: a done milestone was due between its last submission and its approval; the ones still to
  // come are in the future; the late ones keep the date the story needs. Always in order.
  const dues: Date[] = [];
  let previous = -Infinity;
  for (const m of sim.ms) {
    let due: number;
    if (m.fixedDue !== undefined) due = m.fixedDue + shift;
    else if (m.status === 'APPROVED') {
      const submitted = m.submissions.at(-1)!.at + shift;
      due = submitted + random.next() * (m.approvedAt! + shift - submitted);
      due = Math.max(due, previous + HOUR);
    } else {
      const from = Math.max(previous, endAt ?? nowMs);
      due = from + (1 + random.next() * 3) * DAY;
    }
    dues.push(at(due));
    previous = due;
  }
  const deadline = at(previous + random.next() * 2 * DAY);

  // The proposal: its versions and the accept (the contract copies the latest version).
  const versions = makeVersions(
    story,
    sim.versionAt.map((value) => value + shift),
    dues,
    deadline,
  );
  const chatLines: ChatLineFact[] = [];
  const proposal: ProposalFact = {
    jobId: service.id,
    clientId: client.id,
    freelancerId: freelancer.id,
    status: 'ACCEPTED',
    latestVersion: versions.length,
    turnUserId: null,
    expiresAt: at(versions.at(-1)!.createdAt.getTime() + PROPOSAL_LIFETIME),
    declineNote: null,
    decidedAt: acceptedAt,
    createdAt: versions[0].createdAt,
    updatedAt: acceptedAt,
    versions,
    events: versionSteps(versions, story, chatLines),
    notices: [],
    contract: null,
  };

  const milestones: MilestoneFact[] = sim.ms.map((m, i) => ({
    position: i + 1,
    title: story.titles[i],
    description: null,
    dueDate: dues[i],
    amount: m.amount,
    status: m.status,
    fundedAt: abs(m.fundedAt),
    submittedAt: abs(m.submittedAt),
    changesRequestedAt: abs(m.changesRequestedAt),
    approvedAt: abs(m.approvedAt),
    cancelledAt: abs(m.cancelledAt),
    autoApproved: m.autoApproved,
    lateWarnedAt: abs(m.lateWarnedAt),
    silentWarnedAt: abs(m.silentWarnedAt),
    unfundedWarnedAt: abs(m.unfundedWarnedAt),
    submissions: m.submissions.map((s, number) => ({
      number: number + 1,
      authorId: freelancer.id,
      note: s.note,
      images: [],
      links: [],
      feedback: s.feedback,
      createdAt: at(s.at + shift),
    })),
  }));
  const events: ContractEventFact[] = sim.events.map(({ at: time, ...e }) => ({
    ...e,
    createdAt: at(time + shift),
  }));
  const contract: ContractFact = {
    scenario,
    proposal: -1,
    jobId: service.id,
    clientId: client.id,
    freelancerId: freelancer.id,
    title: service.title,
    brief: story.brief,
    referenceLinks: [],
    referenceImages: [],
    deadline,
    total: versions.at(-1)!.total,
    status: sim.status,
    endReason: sim.endReason,
    imported: false,
    endRequestedById: null,
    endRequestNote: null,
    endRequestChoice: null,
    endRequestedAt: null,
    completedAt: abs(sim.completedAt),
    endedAt: abs(sim.endedAt),
    createdAt: acceptedAt,
    updatedAt: acceptedAt,
    milestones,
    amendments: [],
    events,
    notices: [],
    review: null,
  };

  // Steps that happen after the key moment, between it and now.
  const current = milestones[story.k - 1];
  const since = (from: Date) =>
    at(from.getTime() + (0.2 + random.next() * 0.6) * (nowMs - from.getTime()));
  if (scenario === 'active-open-amendment') {
    // The freelancer asks for a few more days on the funded milestone (one OPEN amendment). The
    // milestones after it move by the same days, so the due dates stay in order, and the deadline
    // moves too when the last one passes it (the app checks both when the client accepts).
    const createdAt = since(current.fundedAt!);
    const extra = Math.round(2 + random.next() * 3) * DAY;
    const changes = milestones.slice(story.k - 1).map((m) => ({
      op: 'move' as const,
      position: m.position,
      dueDate: at(m.dueDate.getTime() + extra),
    }));
    const lastDue = changes.at(-1)!.dueDate;
    contract.amendments.push({
      proposerId: freelancer.id,
      status: 'OPEN',
      note: `I need a few more days for "${current.title}". Could we move the due dates by ${extra / DAY} days?`,
      deadline: lastDue > deadline ? at(deadline.getTime() + extra) : null,
      changes,
      createdAt,
    });
    events.push({
      type: 'amendment_proposed',
      actorId: freelancer.id,
      createdAt,
      amendment: 0,
    });
  }
  if (sim.endRequest) {
    const requestedAt = since(current.fundedAt!);
    Object.assign(contract, {
      endRequestedById: sim.endRequest.by,
      endRequestNote: sim.endRequest.note,
      endRequestedAt: requestedAt,
    });
    events.push({
      type: 'end_requested',
      actorId: sim.endRequest.by,
      createdAt: requestedAt,
      data: { note: sim.endRequest.note },
    });
  }
  // Reviews: about 70% of the completed contracts, half of the ended ones with approved work.
  const approvedWork = milestones.some((m) => m.status === 'APPROVED');
  if (
    endAt !== null &&
    approvedWork &&
    random.chance(sim.status === 'COMPLETED' ? 0.7 : 0.5)
  ) {
    const commentedAt = at(
      Math.min(nowMs, endAt + (0.2 + random.next() * 3) * DAY),
    );
    const review = ctx.review(random, freelancer, service);
    contract.review = { ...review, commentedAt };
    events.push({
      type: 'review_left',
      actorId: client.id,
      createdAt: commentedAt,
      data: { rating: review.rating },
    });
  }
  events.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  contract.updatedAt = events.at(-1)!.createdAt;
  contract.notices.push(contractNotice(contract, sim, story, ctx));

  // Chat lines in the pair's room, with the same words as the app's own lines.
  const accepter = sim.accepterId;
  chatLines.push({
    fromId: accepter,
    toId: accepter === client.id ? freelancer.id : client.id,
    text: `I accepted the proposal for "${service.title}". The contract has started.`,
    createdAt: acceptedAt,
  });
  for (const e of events) {
    const m = e.position ? milestones[e.position - 1] : null;
    if (!m) continue;
    const paid = `${fmtCredits(m.amount)} credits`;
    if (e.type === 'milestone_funded') {
      chatLines.push({
        fromId: client.id,
        toId: freelancer.id,
        createdAt: e.createdAt,
        text: `I funded milestone ${m.position} "${m.title}" (${paid}). You can start.`,
      });
    } else if (e.type === 'work_submitted') {
      const number = e.data!.submission as number;
      chatLines.push({
        fromId: freelancer.id,
        toId: client.id,
        createdAt: e.createdAt,
        text:
          number === 1
            ? `I submitted the work for milestone ${m.position} "${m.title}".`
            : `I submitted version ${number} of the work for milestone ${m.position} "${m.title}".`,
      });
    } else if (e.type === 'milestone_approved' && e.actorId !== null) {
      chatLines.push({
        fromId: client.id,
        toId: freelancer.id,
        createdAt: e.createdAt,
        text:
          contract.status === 'COMPLETED' && m.position === milestones.length
            ? `I approved milestone ${m.position} "${m.title}" (${paid}). The contract is completed. Thank you!`
            : `I approved milestone ${m.position} "${m.title}" (${paid}).`,
      });
    }
  }

  const moves = sim.moves.map((move) => ({ ...move, at: move.at + shift }));
  return { proposal, contract, moves, chatLines };
}

/** One notification for the latest step of the contract, with the app's own words. */
function contractNotice(
  contract: ContractFact,
  sim: Played,
  story: Story,
  ctx: StoryContext,
): ContractNoticeFact {
  const { client, freelancer } = story.pair;
  const last = contract.events.at(-1)!;
  const m = last.position ? contract.milestones[last.position - 1] : null;
  const title = contract.title;
  const name = (id: number | null) =>
    id === null
      ? SYSTEM_NAME
      : id === client.id
        ? client.name
        : freelancer.name;
  const to = (recipientId: number) => ({
    recipientId,
    recipientSide: (recipientId === client.id
      ? 'client'
      : 'freelancer') as Side,
  });
  const base = {
    kind: 'contract' as const,
    actorId: last.actorId,
    actorName: name(last.actorId),
    position: last.position,
    createdAt: last.createdAt,
  };
  const paid = m ? `${fmtCredits(m.amount)} credits` : '';
  const window = durationText(ctx.G);
  // The time left when the warning was sent (the window started at `from`).
  const left = (from: Date | null) =>
    durationText(from!.getTime() + ctx.G - last.createdAt.getTime());
  const other = (id: number | null) =>
    id === client.id ? freelancer.id : client.id;

  switch (last.type) {
    case 'contract_started':
      return {
        ...base,
        ...to(other(sim.accepterId)),
        step: 'proposal_accepted',
        title: 'Proposal accepted',
        body: `${name(sim.accepterId)} accepted the proposal for ${title}. The contract has started.`,
      };
    case 'milestone_funded':
      return {
        ...base,
        ...to(freelancer.id),
        step: last.type,
        title: 'Milestone funded',
        body: `${client.name} funded milestone ${m!.position} of ${title} (${paid}). You can start the work.`,
      };
    case 'work_submitted':
      return {
        ...base,
        ...to(client.id),
        step: last.type,
        title: 'Work submitted',
        body: `${freelancer.name} submitted work for milestone ${m!.position} of ${title}. Review it and approve or ask for changes.`,
      };
    case 'changes_requested':
      return {
        ...base,
        ...to(freelancer.id),
        step: last.type,
        title: 'Changes requested',
        body: `${client.name} asked for changes on milestone ${m!.position} of ${title}: ${String(last.data!.note)}`,
      };
    case 'milestone_approved':
      return {
        ...base,
        ...to(freelancer.id),
        step: last.type,
        title: 'Milestone approved',
        body: `${client.name} approved milestone ${m!.position} of ${title} (${paid} paid).`,
      };
    case 'warning_sent': {
      const rule = last.data!.rule as DeadlineRule;
      if (rule === 'FREELANCER_LATE') {
        return {
          ...base,
          ...to(freelancer.id),
          step: last.type,
          title: 'Due date passed',
          body: `Milestone ${m!.position} is past its due date. ${left(m!.dueDate)} left to submit.`,
        };
      }
      if (rule === 'CLIENT_SILENT') {
        return {
          ...base,
          ...to(client.id),
          step: last.type,
          title: 'Review the submission',
          body: `Milestone ${m!.position} of ${title} is waiting for your review. If you do not answer within ${left(m!.submittedAt)}, it is approved automatically.`,
        };
      }
      const previous = contract.milestones[m!.position - 2];
      return {
        ...base,
        ...to(client.id),
        step: last.type,
        title: 'Fund the next milestone',
        body: `Milestone ${m!.position} of ${title} is not funded yet. Fund it within ${left(previous.approvedAt)}, or the contract ends.`,
      };
    }
    case 'amendment_proposed': {
      // The same words as AmendmentsService: "2 changes and a new deadline".
      const { changes, deadline } = contract.amendments[0];
      const what = `${changes.length} change${changes.length === 1 ? '' : 's'}${deadline ? ' and a new deadline' : ''}`;
      return {
        ...base,
        ...to(client.id),
        step: last.type,
        title: 'Change request',
        body: `${freelancer.name} asked to change ${title} (${what}). Accept or decline it.`,
      };
    }
    case 'end_requested':
      return {
        ...base,
        ...to(other(last.actorId)),
        step: last.type,
        title: 'End request',
        body: `${name(last.actorId)} asked to end ${title} together. ${contract.endRequestNote}`,
      };
    case 'contract_completed': {
      const final = contract.milestones.at(-1)!;
      const finalPaid = `${fmtCredits(final.amount)} credits`;
      return {
        ...base,
        ...to(freelancer.id),
        step: last.type,
        title: 'Contract completed',
        body: `${client.name} approved the last milestone of ${title} (${finalPaid} paid). The contract is completed.`,
      };
    }
    case 'review_left':
      return {
        ...base,
        ...to(freelancer.id),
        step: last.type,
        title: 'New review',
        body: `${client.name} reviewed ${title} (${contract.review!.rating}/5).`,
      };
    default: {
      // contract_ended
      const reason = contract.endReason!;
      const stopped = contract.milestones.find((x) => x.position === story.k)!;
      const refunded = contract.milestones
        .filter((x) => x.status === 'CANCELLED' && x.fundedAt)
        .map((x) => x.position);
      let body: string;
      if (reason === 'CLIENT_ENDED') {
        body = `${client.name} ended the contract for ${title}. No credits were held.`;
      } else if (reason === 'MUTUAL') {
        body = `${name(last.actorId)} agreed to end ${title}.${refunded.length ? ` Credits of milestone ${refunded.join(', ')} went back.` : ''}`;
      } else {
        const why =
          reason === 'CLIENT_SILENT'
            ? `milestone ${stopped.position} was approved automatically after ${window} without a review (${fmtCredits(stopped.amount)} credits paid), and the contract ended.`
            : reason === 'FREELANCER_LATE'
              ? `milestone ${stopped.position} was not submitted within ${window} after its due date, so the contract ended.${refunded.length ? ` Held credits for milestone ${refunded.join(', ')} went back to the client.` : ''}`
              : `milestone ${stopped.position} was not funded within ${window}, so the contract ended.`;
        body = `${title}: ${why} Approved work stays with the client.`;
      }
      // The person who did not act hears about it; for a sweeper end, the freelancer.
      const recipientId =
        last.actorId === null ? freelancer.id : other(last.actorId);
      return {
        ...base,
        ...to(recipientId),
        step: 'contract_ended',
        title: 'Contract ended',
        body,
      };
    }
  }
}

/** "3 days", "5 hours", "10 minutes" (the same rounding as the sweeper's fmtDuration). */
function durationText(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  const hours = Math.round(minutes / 60);
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`;
  if (hours >= 24) return plural(Math.round(minutes / 1440), 'day');
  if (hours >= 1 && minutes >= 60) return plural(hours, 'hour');
  return plural(minutes, 'minute');
}

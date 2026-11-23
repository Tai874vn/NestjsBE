import { Prisma, ProposalStatus } from '@prisma/client';
import { Side } from './contract-rules';

// Turns database rows into the shapes the API answers with (the "views").
// Dates become ISO text. The frontend plan copies these types, so change them in both plans.

export type PersonSummary = { id: number; name: string; avatar: string | null };
export type JobSummary = {
  id: number;
  title: string;
  image: string | null;
  price: number;
};

/** One milestone row as saved in ProposalVersion.milestones (JSON). dueDate is ISO text. */
export type StoredMilestone = {
  title: string;
  description?: string;
  dueDate: string;
  amount: number;
};

export type VersionBodyView = {
  brief: string;
  referenceLinks: string[];
  referenceImages: string[];
  deadline: string;
  milestones: StoredMilestone[];
};

export type ProposalVersionView = VersionBodyView & {
  id: number;
  number: number;
  authorId: number;
  total: number;
  createdAt: string;
};

export type ContractEventView = {
  id: number;
  type: string;
  data: unknown;
  actor: PersonSummary | null;
  proposalId: number | null;
  contractId: number | null;
  createdAt: string;
};

export type ProposalDetail = {
  id: number;
  status: ProposalStatus;
  job: JobSummary;
  client: PersonSummary;
  freelancer: PersonSummary;
  latestVersion: number;
  turnUserId: number | null;
  expiresAt: string;
  declineNote: string | null;
  decidedAt: string | null;
  /** Oldest first. */
  versions: ProposalVersionView[];
  contractId: number | null;
  viewerRole: Side;
  events: ContractEventView[];
  createdAt: string;
  updatedAt: string;
};

export type ProposalListItem = {
  id: number;
  status: ProposalStatus;
  job: JobSummary;
  client: PersonSummary;
  freelancer: PersonSummary;
  latestVersion: number;
  turnUserId: number | null;
  /** Total and deadline of the latest version. */
  total: number;
  deadline: string;
  expiresAt: string;
  updatedAt: string;
  viewerRole: Side;
};

const personSelect = {
  select: { id: true, name: true, avatar: true },
} as const;
const jobSelect = {
  select: { id: true, title: true, image: true, price: true },
} as const;

/** What the proposal detail page reads. */
export const proposalDetailInclude = {
  job: jobSelect,
  client: personSelect,
  freelancer: personSelect,
  versions: { orderBy: { number: 'asc' } },
  contract: { select: { id: true } },
  events: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    include: { actor: personSelect },
  },
} satisfies Prisma.ProposalInclude;

/** What one row of the proposal list reads: only the latest version. */
export const proposalListInclude = {
  job: jobSelect,
  client: personSelect,
  freelancer: personSelect,
  versions: { orderBy: { number: 'desc' }, take: 1 },
} satisfies Prisma.ProposalInclude;

type DetailRow = Prisma.ProposalGetPayload<{
  include: typeof proposalDetailInclude;
}>;
type ListRow = Prisma.ProposalGetPayload<{
  include: typeof proposalListInclude;
}>;
type VersionRow = DetailRow['versions'][number];
type EventRow = DetailRow['events'][number];

/** Which side the viewer is on, or null when they are not on this proposal. */
export function sideOf(
  p: { clientId: number; freelancerId: number },
  userId: number,
): Side | null {
  if (p.clientId === userId) return 'client';
  if (p.freelancerId === userId) return 'freelancer';
  return null;
}

/** The milestone list saved as JSON on a version. */
export function storedMilestones(json: Prisma.JsonValue): StoredMilestone[] {
  return json as unknown as StoredMilestone[];
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

export function versionView(v: VersionRow): ProposalVersionView {
  return {
    id: v.id,
    number: v.number,
    authorId: v.authorId,
    brief: v.brief,
    referenceLinks: v.referenceLinks,
    referenceImages: v.referenceImages,
    deadline: v.deadline.toISOString(),
    milestones: storedMilestones(v.milestones),
    total: v.total,
    createdAt: v.createdAt.toISOString(),
  };
}

export function eventView(e: EventRow): ContractEventView {
  return {
    id: e.id,
    type: e.type,
    data: e.data,
    actor: e.actor,
    proposalId: e.proposalId,
    contractId: e.contractId,
    createdAt: e.createdAt.toISOString(),
  };
}

export function proposalDetailView(
  row: DetailRow,
  viewerRole: Side,
): ProposalDetail {
  return {
    id: row.id,
    status: row.status,
    job: row.job,
    client: row.client,
    freelancer: row.freelancer,
    latestVersion: row.latestVersion,
    turnUserId: row.turnUserId,
    expiresAt: row.expiresAt.toISOString(),
    declineNote: row.declineNote,
    decidedAt: iso(row.decidedAt),
    versions: row.versions.map(versionView),
    contractId: row.contract?.id ?? null,
    viewerRole,
    events: row.events.map(eventView),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function proposalListItemView(
  row: ListRow,
  viewerRole: Side,
): ProposalListItem {
  // Every proposal has at least version 1, so the latest version is always there.
  const latest = row.versions[0];
  return {
    id: row.id,
    status: row.status,
    job: row.job,
    client: row.client,
    freelancer: row.freelancer,
    latestVersion: row.latestVersion,
    turnUserId: row.turnUserId,
    total: latest.total,
    deadline: latest.deadline.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    viewerRole,
  };
}

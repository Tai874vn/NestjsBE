import {
  AmendmentStatus,
  ContractStatus,
  MilestoneStatus,
  Prisma,
  ProposalStatus,
} from '@prisma/client';
import { HELD_STATUSES, Side } from './contract-rules';
import type { EndReason } from './contract-events.service';

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

// ---------- Contracts ----------

export type SubmissionView = {
  id: number;
  number: number;
  note: string;
  images: string[];
  links: string[];
  feedback: string | null;
  createdAt: string;
};

export type MilestoneView = {
  id: number;
  position: number;
  title: string;
  description: string | null;
  dueDate: string;
  amount: number;
  status: MilestoneStatus;
  fundedAt: string | null;
  submittedAt: string | null;
  changesRequestedAt: string | null;
  approvedAt: string | null;
  autoApproved: boolean;
  /** Which day-2 warnings were sent (one flag per deadline rule). */
  warnings: { late: boolean; silent: boolean; unfunded: boolean };
  /** Newest first. */
  submissions: SubmissionView[];
};

export type AmendmentChange =
  | {
      op: 'add';
      title: string;
      description?: string;
      dueDate: string;
      amount: number;
    }
  | { op: 'move'; milestoneId: number; dueDate: string }
  | { op: 'amount'; milestoneId: number; amount: number };

export type AmendmentView = {
  id: number;
  status: AmendmentStatus;
  proposerId: number;
  note: string | null;
  deadline: string | null;
  changes: AmendmentChange[];
  declineNote: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type ContractDetail = {
  id: number;
  status: ContractStatus;
  endReason: EndReason | null;
  imported: boolean;
  title: string;
  brief: string;
  referenceLinks: string[];
  referenceImages: string[];
  deadline: string;
  job: JobSummary;
  client: PersonSummary;
  freelancer: PersonSummary;
  proposalId: number | null;
  /** paid = APPROVED, held = FUNDED + SUBMITTED + CHANGES_REQUESTED, remaining = PENDING. */
  total: number;
  paid: number;
  held: number;
  remaining: number;
  milestones: MilestoneView[];
  /** Newest first. */
  amendments: AmendmentView[];
  endRequest: {
    byUserId: number;
    note: string | null;
    choice: 'APPROVE' | 'REFUND' | null;
    requestedAt: string;
  } | null;
  review: { id: number; rating: number; content: string } | null;
  canReview: boolean;
  graceMinutes: number;
  /** Proposal and contract history, oldest first. */
  events: ContractEventView[];
  viewerRole: Side;
  createdAt: string;
  completedAt: string | null;
  endedAt: string | null;
};

export type ContractListItem = {
  id: number;
  status: ContractStatus;
  endReason: EndReason | null;
  title: string;
  job: JobSummary;
  client: PersonSummary;
  freelancer: PersonSummary;
  total: number;
  paid: number;
  held: number;
  /** The first milestone that is not APPROVED or CANCELLED. */
  currentMilestone: {
    id: number;
    position: number;
    title: string;
    status: MilestoneStatus;
    dueDate: string;
    amount: number;
    submittedAt: string | null;
  } | null;
  milestoneCount: number;
  hasOpenAmendment: boolean;
  endRequestedById: number | null;
  viewerRole: Side;
  updatedAt: string;
};

/**
 * What the contract detail page reads. The history is read on its own (it also has the
 * proposal's rows), see ContractsQueryService.
 */
export const contractDetailInclude = {
  job: jobSelect,
  client: personSelect,
  freelancer: personSelect,
  milestones: {
    orderBy: { position: 'asc' },
    include: { submissions: { orderBy: { number: 'desc' } } },
  },
  amendments: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
  review: { select: { id: true, rating: true, content: true } },
} satisfies Prisma.ContractInclude;

/** What the history of a contract reads (proposal rows and contract rows). */
export const contractEventInclude = {
  actor: personSelect,
} satisfies Prisma.ContractEventInclude;

/** What one row of the contract list reads. */
export const contractListInclude = {
  job: jobSelect,
  client: personSelect,
  freelancer: personSelect,
  milestones: { orderBy: { position: 'asc' } },
  amendments: {
    where: { status: AmendmentStatus.OPEN },
    select: { id: true },
  },
} satisfies Prisma.ContractInclude;

type ContractDetailRow = Prisma.ContractGetPayload<{
  include: typeof contractDetailInclude;
}>;
type ContractListRow = Prisma.ContractGetPayload<{
  include: typeof contractListInclude;
}>;
type MilestoneRow = ContractDetailRow['milestones'][number];
type AmendmentRow = ContractDetailRow['amendments'][number];

const MS = MilestoneStatus;

/** Credits paid (APPROVED), held (funded, not approved yet) and still to fund (PENDING). */
export function moneyOf(
  milestones: { status: MilestoneStatus; amount: number }[],
) {
  const sum = (statuses: readonly MilestoneStatus[]) =>
    milestones
      .filter((m) => statuses.includes(m.status))
      .reduce((total, m) => total + m.amount, 0);
  return {
    paid: sum([MS.APPROVED]),
    held: sum(HELD_STATUSES),
    remaining: sum([MS.PENDING]),
  };
}

/**
 * The client may leave one review for a contract: after COMPLETED, or after ENDED when at least
 * one milestone was approved (spec 4.7).
 */
export function canReviewContract(
  c: {
    clientId: number;
    status: ContractStatus;
    milestones: { status: MilestoneStatus }[];
    review: unknown;
  },
  viewerId: number,
): boolean {
  if (viewerId !== c.clientId || c.review) return false;
  if (c.status === ContractStatus.COMPLETED) return true;
  return (
    c.status === ContractStatus.ENDED &&
    c.milestones.some((m) => m.status === MS.APPROVED)
  );
}

function milestoneView(m: MilestoneRow): MilestoneView {
  return {
    id: m.id,
    position: m.position,
    title: m.title,
    description: m.description,
    dueDate: m.dueDate.toISOString(),
    amount: m.amount,
    status: m.status,
    fundedAt: iso(m.fundedAt),
    submittedAt: iso(m.submittedAt),
    changesRequestedAt: iso(m.changesRequestedAt),
    approvedAt: iso(m.approvedAt),
    autoApproved: m.autoApproved,
    warnings: {
      late: m.lateWarnedAt !== null,
      silent: m.silentWarnedAt !== null,
      unfunded: m.unfundedWarnedAt !== null,
    },
    submissions: m.submissions.map((s) => ({
      id: s.id,
      number: s.number,
      note: s.note,
      images: s.images,
      links: s.links,
      feedback: s.feedback,
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

function amendmentView(a: AmendmentRow): AmendmentView {
  return {
    id: a.id,
    status: a.status,
    proposerId: a.proposerId,
    note: a.note,
    deadline: iso(a.deadline),
    changes: a.changes as unknown as AmendmentChange[],
    declineNote: a.declineNote,
    createdAt: a.createdAt.toISOString(),
    decidedAt: iso(a.decidedAt),
  };
}

export function contractDetailView(
  row: ContractDetailRow,
  events: EventRow[],
  viewer: { id: number; role: Side },
  graceMinutes: number,
): ContractDetail {
  return {
    id: row.id,
    status: row.status,
    endReason: row.endReason as EndReason | null,
    imported: row.imported,
    title: row.title,
    brief: row.brief,
    referenceLinks: row.referenceLinks,
    referenceImages: row.referenceImages,
    deadline: row.deadline.toISOString(),
    job: row.job,
    client: row.client,
    freelancer: row.freelancer,
    proposalId: row.proposalId,
    total: row.total,
    ...moneyOf(row.milestones),
    milestones: row.milestones.map(milestoneView),
    amendments: row.amendments.map(amendmentView),
    endRequest:
      row.endRequestedById !== null
        ? {
            byUserId: row.endRequestedById,
            note: row.endRequestNote,
            choice: row.endRequestChoice as 'APPROVE' | 'REFUND' | null,
            requestedAt: (row.endRequestedAt ?? row.updatedAt).toISOString(),
          }
        : null,
    review: row.review,
    canReview: canReviewContract(row, viewer.id),
    graceMinutes,
    events: events.map(eventView),
    viewerRole: viewer.role,
    createdAt: row.createdAt.toISOString(),
    completedAt: iso(row.completedAt),
    endedAt: iso(row.endedAt),
  };
}

export function contractListItemView(
  row: ContractListRow,
  viewerRole: Side,
): ContractListItem {
  const { paid, held } = moneyOf(row.milestones);
  const current = row.milestones.find(
    (m) => m.status !== MS.APPROVED && m.status !== MS.CANCELLED,
  );
  return {
    id: row.id,
    status: row.status,
    endReason: row.endReason as EndReason | null,
    title: row.title,
    job: row.job,
    client: row.client,
    freelancer: row.freelancer,
    total: row.total,
    paid,
    held,
    currentMilestone: current
      ? {
          id: current.id,
          position: current.position,
          title: current.title,
          status: current.status,
          dueDate: current.dueDate.toISOString(),
          amount: current.amount,
          submittedAt: iso(current.submittedAt),
        }
      : null,
    milestoneCount: row.milestones.length,
    hasOpenAmendment: row.amendments.length > 0,
    endRequestedById: row.endRequestedById,
    viewerRole,
    updatedAt: row.updatedAt.toISOString(),
  };
}

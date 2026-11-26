import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { MilestoneStatus, Prisma, ProposalStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import {
  checkProposalAction,
  checkVersion,
  fmtCredits,
  ProposalAction,
  RuleError,
  Side,
  versionTotal,
} from '../utils/contract-rules';
import {
  ContractAnnounceInput,
  ContractEventsService,
} from './contract-events.service';
import {
  ProposalDetail,
  proposalDetailInclude,
  proposalDetailView,
  ProposalListItem,
  proposalListInclude,
  proposalListItemView,
  sideOf,
  StoredMilestone,
  storedMilestones,
} from '../utils/contract-views';
import { Paginated } from '../../wallet/services/wallet.service';

const P = ProposalStatus;

/** An OPEN proposal expires 7 days after its latest version. */
export const PROPOSAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

/** The signed-in user (only the id matters here: any role may use proposals). */
export type Viewer = { id: number };

/** A version as the API receives it (see VersionBodyDto). Dates are ISO text. */
export type VersionInput = {
  brief: string;
  referenceLinks: string[];
  referenceImages: string[];
  deadline: string;
  milestones: {
    title: string;
    description?: string;
    dueDate: string;
    amount: number;
  }[];
};

export type ProposalListQuery = {
  role: Side;
  status?: ProposalStatus;
  page: number;
  pageSize: number;
};

/** What every action reads from the proposal after locking it. */
const lockedInclude = {
  job: { select: { id: true, title: true } },
  client: { select: { id: true, name: true } },
  freelancer: { select: { id: true, name: true } },
  versions: { orderBy: { number: 'desc' }, take: 1 },
} satisfies Prisma.ProposalInclude;

type LockedProposal = Prisma.ProposalGetPayload<{
  include: typeof lockedInclude;
}>;

type StepInput = {
  tx: Prisma.TransactionClient;
  proposal: LockedProposal;
  side: Side;
  now: Date;
};

/** The notification of a step, without the parts run() fills in. */
type StepNotice = Omit<
  ContractAnnounceInput,
  'recipientId' | 'actorId' | 'actorName' | 'proposalId' | 'recipientSide'
>;

type Step<R> = {
  action: ProposalAction;
  /** The version number the user read (accept only). */
  acceptVersion?: number;
  /** Write the change and its history rows; the result goes to notice(). */
  write: (input: StepInput) => Promise<R>;
  notice: (proposal: LockedProposal, result: R) => StepNotice;
  message: string;
};

/** A version checked and ready to save. */
type ParsedVersion = {
  brief: string;
  referenceLinks: string[];
  referenceImages: string[];
  deadline: Date;
  milestones: StoredMilestone[];
  total: number;
};

/**
 * Proposals: a client's offer on a service, with versions (counter-offers) until one side accepts,
 * declines or withdraws. Accepting makes the contract in the same transaction.
 *
 * Every action on an existing proposal runs the same way (see run()):
 *  1. A transaction (a group of database changes saved together or not at all) locks the proposal
 *     row with SELECT ... FOR UPDATE ("this row is mine until the transaction ends"). So when the
 *     freelancer accepts version 2 while the client sends version 3, one waits for the other, and
 *     the second then sees the new state and gets 409. One proposal never gets two contracts.
 *  2. It reads the proposal again and checks the rules (contract-rules.ts): not on the proposal 403,
 *     closed or not your turn 409, wrong version body 400.
 *  3. It writes the change and its history row (ContractEvent).
 *  4. After the save (commit), the other side gets a notification (and a chat line for sent,
 *     countered and accepted).
 */
@Injectable()
export class ProposalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ContractEventsService,
  ) {}

  /** Client: a new OPEN proposal on a service; the freelancer (service owner) answers first. */
  async create(viewer: Viewer, input: VersionInput & { jobId: number }) {
    const job = await this.prisma.job.findUnique({
      where: { id: input.jobId },
      select: { id: true, title: true, creatorId: true },
    });
    if (!job) {
      throw new NotFoundException(`Service with ID ${input.jobId} not found`);
    }
    if (job.creatorId === viewer.id) {
      throw new ForbiddenException(
        'You cannot send a proposal to your own service.',
      );
    }
    const now = new Date();
    const version = this.parseVersion(input, now);

    let proposalId: number;
    try {
      proposalId = await this.prisma.$transaction(async (tx) => {
        // The partial unique index proposals_one_open_per_client_job allows one OPEN proposal
        // per client per service; a second one fails here with P2002.
        const proposal = await tx.proposal.create({
          data: {
            jobId: job.id,
            clientId: viewer.id,
            freelancerId: job.creatorId,
            status: P.OPEN,
            latestVersion: 1,
            turnUserId: job.creatorId,
            expiresAt: new Date(now.getTime() + PROPOSAL_LIFETIME_MS),
          },
          select: { id: true },
        });
        await this.saveVersion(tx, proposal.id, 1, viewer.id, version, now);
        await this.events.record(tx, {
          proposalId: proposal.id,
          actorId: viewer.id,
          type: 'proposal_sent',
          data: { version: 1, total: version.total },
        });
        return proposal.id;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'You already have an open proposal for this service.',
        );
      }
      throw error;
    }

    const detail = await this.detail(proposalId, viewer);
    const clientName = detail.client.name;
    await this.events.announce({
      recipientId: job.creatorId,
      actorId: viewer.id,
      actorName: clientName,
      kind: 'proposal',
      step: 'proposal_sent',
      jobTitle: job.title,
      title: 'New proposal',
      body: `${clientName} sent a proposal for ${job.title} (${fmtCredits(version.total)} credits).`,
      proposalId,
      recipientSide: 'freelancer',
      chat: {
        fromId: viewer.id,
        toId: job.creatorId,
        text: `I sent a proposal for "${job.title}": ${fmtCredits(version.total)} credits in ${this.milestoneCount(version.milestones.length)}.`,
      },
    });
    return { message: 'Proposal sent', content: detail };
  }

  async list(
    viewer: Viewer,
    query: ProposalListQuery,
  ): Promise<{ message: string; content: Paginated<ProposalListItem> }> {
    const where: Prisma.ProposalWhereInput = {
      ...(query.role === 'client'
        ? { clientId: viewer.id }
        : { freelancerId: viewer.id }),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.proposal.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: proposalListInclude,
      }),
      this.prisma.proposal.count({ where }),
    ]);
    return {
      message: 'Proposals fetched',
      content: {
        data: rows.map((row) => proposalListItemView(row, query.role)),
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async findOne(id: number, viewer: Viewer) {
    return {
      message: 'Proposal fetched',
      content: await this.detail(id, viewer),
    };
  }

  /** The side whose turn it is: a new version with edits; the turn passes to the other side. */
  counter(id: number, viewer: Viewer, input: VersionInput) {
    return this.run(id, viewer, {
      action: 'counter',
      message: 'Counter-offer sent',
      write: async ({ tx, proposal, side, now }) => {
        const version = this.parseVersion(input, now);
        const number = proposal.latestVersion + 1;
        await this.saveVersion(
          tx,
          proposal.id,
          number,
          viewer.id,
          version,
          now,
        );
        await tx.proposal.update({
          where: { id: proposal.id },
          data: {
            latestVersion: number,
            turnUserId: this.otherId(proposal, side),
            expiresAt: new Date(now.getTime() + PROPOSAL_LIFETIME_MS),
          },
        });
        await this.events.record(tx, {
          proposalId: proposal.id,
          actorId: viewer.id,
          type: 'proposal_countered',
          data: { version: number, total: version.total },
        });
        return { number, total: version.total };
      },
      notice: (proposal, { number, total }) => ({
        kind: 'proposal',
        step: 'proposal_countered',
        title: 'Counter-offer',
        body: `${this.nameOf(proposal, viewer.id)} sent version ${number} for ${proposal.job.title} (${fmtCredits(total)} credits).`,
        chat: {
          fromId: viewer.id,
          toId: this.otherId(proposal, this.sideOrThrow(proposal, viewer)),
          text: `I sent version ${number} of the proposal for "${proposal.job.title}": ${fmtCredits(total)} credits.`,
        },
      }),
    });
  }

  /**
   * The side whose turn it is accepts the version it read. If a newer version was sent meanwhile,
   * 409. The contract is made in the same transaction: it copies the latest version, and its
   * milestones get positions 1, 2, 3... and status PENDING.
   */
  accept(id: number, viewer: Viewer, version: number) {
    return this.run(id, viewer, {
      action: 'accept',
      acceptVersion: version,
      message: 'Proposal accepted',
      write: async ({ tx, proposal, now }) => {
        const latest = this.latestOf(proposal);
        const milestones = storedMilestones(latest.milestones);
        // Spec 4.2: the first due date is in the future. A version can wait up to 7 days, so a
        // contract must not start already late; the turn holder can counter with new dates.
        if (new Date(milestones[0].dueDate).getTime() <= now.getTime()) {
          throw new ConflictException(
            'The first due date has passed. Send a counter-offer with new dates.',
          );
        }
        let contract: { id: number };
        try {
          contract = await tx.contract.create({
            data: {
              proposalId: proposal.id,
              jobId: proposal.jobId,
              clientId: proposal.clientId,
              freelancerId: proposal.freelancerId,
              title: proposal.job.title,
              brief: latest.brief,
              referenceLinks: latest.referenceLinks,
              referenceImages: latest.referenceImages,
              deadline: latest.deadline,
              total: latest.total,
              milestones: {
                create: milestones.map((m, index) => ({
                  position: index + 1,
                  title: m.title,
                  description: m.description ?? null,
                  dueDate: new Date(m.dueDate),
                  amount: m.amount,
                  status: MilestoneStatus.PENDING,
                })),
              },
            },
            select: { id: true },
          });
        } catch (error) {
          // Contract.proposalId is unique: a second contract for one proposal can never be saved.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw new ConflictException('This proposal was already accepted.');
          }
          throw error;
        }
        await tx.proposal.update({
          where: { id: proposal.id },
          data: { status: P.ACCEPTED, turnUserId: null, decidedAt: now },
        });
        const ids = { proposalId: proposal.id, contractId: contract.id };
        await this.events.record(tx, {
          ...ids,
          actorId: viewer.id,
          type: 'proposal_accepted',
          data: { version: latest.number },
        });
        await this.events.record(tx, {
          ...ids,
          actorId: viewer.id,
          type: 'contract_started',
          data: { total: latest.total },
        });
        return contract.id;
      },
      // The link goes to the new contract.
      notice: (proposal, contractId) => ({
        kind: 'contract',
        step: 'proposal_accepted',
        title: 'Proposal accepted',
        body: `${this.nameOf(proposal, viewer.id)} accepted the proposal for ${proposal.job.title}. The contract has started.`,
        contractId,
        chat: {
          fromId: viewer.id,
          toId: this.otherId(proposal, this.sideOrThrow(proposal, viewer)),
          text: `I accepted the proposal for "${proposal.job.title}". The contract has started.`,
        },
      }),
    });
  }

  /** The side whose turn it is says no, with an optional note. */
  decline(id: number, viewer: Viewer, note?: string) {
    return this.run(id, viewer, {
      action: 'decline',
      message: 'Proposal declined',
      write: async ({ tx, proposal, now }) => {
        await tx.proposal.update({
          where: { id: proposal.id },
          data: {
            status: P.DECLINED,
            declineNote: note ?? null,
            turnUserId: null,
            decidedAt: now,
          },
        });
        await this.events.record(tx, {
          proposalId: proposal.id,
          actorId: viewer.id,
          type: 'proposal_declined',
          data: note ? { note } : {},
        });
      },
      notice: (proposal) => ({
        kind: 'proposal',
        step: 'proposal_declined',
        title: 'Proposal declined',
        body: `${this.nameOf(proposal, viewer.id)} declined the proposal for ${proposal.job.title}.${note ? ` Note: ${note}` : ''}`,
      }),
    });
  }

  /** The person who sent the latest version takes it back. */
  withdraw(id: number, viewer: Viewer) {
    return this.run(id, viewer, {
      action: 'withdraw',
      message: 'Proposal withdrawn',
      write: async ({ tx, proposal, now }) => {
        await tx.proposal.update({
          where: { id: proposal.id },
          data: { status: P.WITHDRAWN, turnUserId: null, decidedAt: now },
        });
        await this.events.record(tx, {
          proposalId: proposal.id,
          actorId: viewer.id,
          type: 'proposal_withdrawn',
        });
      },
      notice: (proposal) => ({
        kind: 'proposal',
        step: 'proposal_withdrawn',
        title: 'Proposal withdrawn',
        body: `${this.nameOf(proposal, viewer.id)} withdrew the proposal for ${proposal.job.title}.`,
      }),
    });
  }

  /** The proposal page for one of its two sides; anyone else gets 403. */
  async detail(id: number, viewer: Viewer): Promise<ProposalDetail> {
    const row = await this.prisma.proposal.findUnique({
      where: { id },
      include: proposalDetailInclude,
    });
    if (!row) throw this.notFound(id);
    const side = sideOf(row, viewer.id);
    if (!side) throw this.forbidden();
    return proposalDetailView(row, side);
  }

  /** The shared steps of every action (see the class comment). */
  private async run<R>(id: number, viewer: Viewer, step: Step<R>) {
    const { proposal, side, result } = await this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "proposals" WHERE id = ${id} FOR UPDATE`;
        const proposal = await tx.proposal.findUnique({
          where: { id },
          include: lockedInclude,
        });
        if (!proposal) throw this.notFound(id);
        const side = this.sideOrThrow(proposal, viewer);
        const now = new Date();
        // Past its 7 days but the sweeper has not marked it yet: treat it as expired.
        if (
          proposal.status === P.OPEN &&
          proposal.expiresAt.getTime() <= now.getTime()
        ) {
          throw new ConflictException('This proposal already expired.');
        }
        this.mapRuleError(() =>
          checkProposalAction(
            step.action,
            viewer.id,
            {
              status: proposal.status,
              turnUserId: proposal.turnUserId,
              latestAuthorId: this.latestOf(proposal).authorId,
              latestVersion: proposal.latestVersion,
            },
            step.acceptVersion,
          ),
        );
        const result = await step.write({ tx, proposal, side, now });
        return { proposal, side, result };
      },
    );

    // After commit: tell the other side; announce() never throws.
    const other = side === 'client' ? 'freelancer' : 'client';
    await this.events.announce({
      jobTitle: proposal.job.title,
      ...step.notice(proposal, result),
      recipientId: this.otherId(proposal, side),
      actorId: viewer.id,
      actorName: this.nameOf(proposal, viewer.id),
      proposalId: proposal.id,
      recipientSide: other,
    });

    return { message: step.message, content: await this.detail(id, viewer) };
  }

  /** Check a version (rules in contract-rules.ts → 400) and get it ready to save. */
  private parseVersion(input: VersionInput, now: Date): ParsedVersion {
    const deadline = new Date(input.deadline);
    const drafts = input.milestones.map((m) => ({
      title: m.title,
      description: m.description,
      dueDate: new Date(m.dueDate),
      amount: m.amount,
    }));
    this.mapRuleError(() =>
      checkVersion({ deadline, milestones: drafts }, now),
    );
    return {
      brief: input.brief,
      referenceLinks: input.referenceLinks,
      referenceImages: input.referenceImages,
      deadline,
      milestones: drafts.map((m) => ({
        title: m.title,
        ...(m.description ? { description: m.description } : {}),
        dueDate: m.dueDate.toISOString(),
        amount: m.amount,
      })),
      total: versionTotal(drafts),
    };
  }

  private async saveVersion(
    tx: Prisma.TransactionClient,
    proposalId: number,
    number: number,
    authorId: number,
    v: ParsedVersion,
    now: Date,
  ) {
    await tx.proposalVersion.create({
      data: {
        proposalId,
        number,
        authorId,
        brief: v.brief,
        referenceLinks: v.referenceLinks,
        referenceImages: v.referenceImages,
        deadline: v.deadline,
        milestones: v.milestones as unknown as Prisma.InputJsonValue,
        total: v.total,
        // expiresAt counts from this moment.
        createdAt: now,
      },
    });
  }

  /** The latest version (the locked read takes only that one). */
  private latestOf(proposal: LockedProposal) {
    const latest = proposal.versions.find(
      (v) => v.number === proposal.latestVersion,
    );
    if (!latest) {
      throw new Error(
        `Proposal ${proposal.id} has no version ${proposal.latestVersion}`,
      );
    }
    return latest;
  }

  private sideOrThrow(
    proposal: { clientId: number; freelancerId: number },
    viewer: Viewer,
  ): Side {
    const side = sideOf(proposal, viewer.id);
    if (!side) throw this.forbidden();
    return side;
  }

  /** The user id of the other side. */
  private otherId(proposal: LockedProposal, side: Side) {
    return side === 'client' ? proposal.freelancerId : proposal.clientId;
  }

  private nameOf(proposal: LockedProposal, userId: number) {
    return userId === proposal.clientId
      ? proposal.client.name
      : proposal.freelancer.name;
  }

  private milestoneCount(n: number) {
    return n === 1 ? '1 milestone' : `${n} milestones`;
  }

  /** Rule errors become 403 (wrong person), 409 (wrong state) or 400 (bad input). */
  private mapRuleError(check: () => void) {
    try {
      check();
    } catch (error) {
      if (error instanceof RuleError) {
        if (error.kind === 'forbidden') {
          throw new ForbiddenException(error.message);
        }
        if (error.kind === 'conflict') {
          throw new ConflictException(error.message);
        }
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  private forbidden() {
    return new ForbiddenException('You are not part of this proposal.');
  }

  private notFound(id: number) {
    return new NotFoundException(`Proposal with ID ${id} not found`);
  }
}

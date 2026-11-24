import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AmendmentStatus,
  ContractStatus,
  MilestoneStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import {
  AmendmentChangeParsed,
  checkAmendment,
  fmtCredits,
} from './contract-rules';
import { ContractEndingService } from './contract-ending.service';
import { ContractEventsService } from './contract-events.service';
import {
  ContractStepService,
  ContractViewer,
  LockedContract,
  ruleToHttp,
} from './contract-step.service';
import { AmendmentChange } from './contract-views';
import { CreateAmendmentDto, parseAmendmentChanges } from './dto/amendment.dto';

const A = AmendmentStatus;
const C = ContractStatus;
const M = MilestoneStatus;

/** Setting these to null clears the three day-2 warning flags of a milestone. */
const NO_WARNINGS = {
  lateWarnedAt: null,
  silentWarnedAt: null,
  unfundedWarnedAt: null,
} satisfies Prisma.MilestoneUpdateInput;

const AMENDMENT_CLOSED: Record<AmendmentStatus, string> = {
  OPEN: 'open',
  ACCEPTED: 'This change request was already accepted.',
  DECLINED: 'This change request was already declined.',
  WITHDRAWN: 'This change request was already withdrawn.',
  CANCELLED: 'This change request was cancelled when the contract ended.',
};

export type EndChoice = 'APPROVE' | 'REFUND';

/**
 * Changes in the middle of a contract, and the mutual end. Every action runs through
 * ContractStepService.run() (contract row lock, fresh read, side check, write, then the notice
 * after the save).
 *
 * Amendments: either side asks to add a milestone, move a due date or change an amount (and
 * optionally set a new overall deadline); the other side accepts or declines, the asker may
 * withdraw. Only one can be open per contract. An open one does NOT pause any deadline timer.
 *
 * End requests: one is kept on the Contract row. The other side accepts (the contract ends, MUTUAL),
 * declines, or the asker withdraws.
 */
@Injectable()
export class AmendmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly step: ContractStepService,
    private readonly events: ContractEventsService,
    private readonly ending: ContractEndingService,
  ) {}

  // ---------- Amendments ----------

  /** Either side: ask for a change. Checked against the contract as it is now. */
  async propose(
    contractId: number,
    viewer: ContractViewer,
    input: CreateAmendmentDto,
  ) {
    const parsed = {
      deadline: input.deadline ? new Date(input.deadline) : undefined,
      changes: parseAmendmentChanges(input.changes),
    };
    const note = input.note?.trim() || null;
    return this.step.run(contractId, viewer, {
      message: 'Change request sent',
      write: async ({ tx, contract, now }) => {
        this.assertActive(contract);
        ruleToHttp(() =>
          checkAmendment(parsed, contract.milestones, contract.deadline, now),
        );
        const open = await tx.amendment.findFirst({
          where: { contractId: contract.id, status: A.OPEN },
          select: { id: true },
        });
        if (open) throw openAmendmentError();
        let amendmentId: number;
        try {
          const created = await tx.amendment.create({
            data: {
              contractId: contract.id,
              proposerId: viewer.id,
              note,
              deadline: parsed.deadline ?? null,
              changes: toJson(parsed.changes),
              createdAt: now,
            },
            select: { id: true },
          });
          amendmentId = created.id;
        } catch (error) {
          // The partial unique index amendments_one_open_per_contract: one OPEN per contract.
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            throw openAmendmentError();
          }
          throw error;
        }
        await this.events.record(tx, {
          contractId: contract.id,
          actorId: viewer.id,
          type: 'amendment_proposed',
          data: { amendmentId },
        });
        return { amendmentId, count: parsed.changes.length };
      },
      notice: (contract, { count }) => ({
        kind: 'contract',
        step: 'amendment_proposed',
        title: 'Change request',
        body: `${this.actorName(contract, viewer.id)} asked to change ${contract.title} (${describe(count, parsed.deadline)}). Accept or decline it.`,
      }),
    });
  }

  /** The other side: apply the changes. */
  async accept(amendmentId: number, viewer: ContractViewer) {
    const contractId = await this.contractIdOfAmendment(amendmentId);
    return this.step.run(contractId, viewer, {
      message: 'Change request accepted',
      write: async ({ tx, contract, now }) => {
        const a = await this.openAmendment(tx, contract, amendmentId);
        if (a.proposerId === viewer.id) {
          throw new ForbiddenException(
            'Only the other person can accept this change request.',
          );
        }
        const changes = (a.changes as unknown as AmendmentChange[]).map(
          fromJson,
        );
        // The milestones may have moved on since it was sent: check again.
        ruleToHttp(() =>
          checkAmendment(
            { deadline: a.deadline ?? undefined, changes },
            contract.milestones,
            contract.deadline,
            now,
          ),
        );
        let total = contract.total;
        let nextPosition = contract.milestones.reduce(
          (max, m) => Math.max(max, m.position),
          0,
        );
        for (const change of changes) {
          if (change.op === 'add') {
            await tx.milestone.create({
              data: {
                contractId: contract.id,
                position: ++nextPosition,
                title: change.title,
                description: change.description ?? null,
                dueDate: change.dueDate,
                amount: change.amount,
                status: M.PENDING,
              },
            });
            total += change.amount;
            continue;
          }
          const m = contract.milestones.find(
            (x) => x.id === change.milestoneId,
          )!;
          if (change.op === 'move') {
            await tx.milestone.update({
              where: { id: m.id },
              data: { dueDate: change.dueDate, ...NO_WARNINGS },
            });
          } else {
            await tx.milestone.update({
              where: { id: m.id },
              data: { amount: change.amount, ...NO_WARNINGS },
            });
            total += change.amount - m.amount;
          }
        }
        await tx.contract.update({
          where: { id: contract.id },
          data: { total, ...(a.deadline ? { deadline: a.deadline } : {}) },
        });
        await tx.amendment.update({
          where: { id: a.id },
          data: { status: A.ACCEPTED, decidedAt: now },
        });
        await this.events.record(tx, {
          contractId: contract.id,
          actorId: viewer.id,
          type: 'amendment_accepted',
          data: { amendmentId: a.id },
        });
        return { total };
      },
      notice: (contract, { total }) => ({
        kind: 'contract',
        step: 'amendment_accepted',
        title: 'Change request accepted',
        body: `${this.actorName(contract, viewer.id)} accepted your change request on ${contract.title}. The total is now ${fmtCredits(total)} credits.`,
      }),
    });
  }

  /** The other side: say no, with an optional note. */
  async decline(
    amendmentId: number,
    viewer: ContractViewer,
    note: string | undefined,
  ) {
    const contractId = await this.contractIdOfAmendment(amendmentId);
    const declineNote = note?.trim() || null;
    return this.step.run(contractId, viewer, {
      message: 'Change request declined',
      write: async ({ tx, contract, now }) => {
        const a = await this.openAmendment(tx, contract, amendmentId);
        if (a.proposerId === viewer.id) {
          throw new ForbiddenException(
            'Only the other person can decline this change request.',
          );
        }
        await tx.amendment.update({
          where: { id: a.id },
          data: { status: A.DECLINED, declineNote, decidedAt: now },
        });
        await this.events.record(tx, {
          contractId: contract.id,
          actorId: viewer.id,
          type: 'amendment_declined',
          data: {
            amendmentId: a.id,
            ...(declineNote ? { note: declineNote } : {}),
          },
        });
      },
      notice: (contract) => ({
        kind: 'contract',
        step: 'amendment_declined',
        title: 'Change request declined',
        body: `${this.actorName(contract, viewer.id)} declined your change request on ${contract.title}.${declineNote ? ` ${declineNote}` : ''}`,
      }),
    });
  }

  /** The asker: take the request back. */
  async withdraw(amendmentId: number, viewer: ContractViewer) {
    const contractId = await this.contractIdOfAmendment(amendmentId);
    return this.step.run(contractId, viewer, {
      message: 'Change request withdrawn',
      write: async ({ tx, contract, now }) => {
        const a = await this.openAmendment(tx, contract, amendmentId);
        if (a.proposerId !== viewer.id) {
          throw new ForbiddenException(
            'Only the person who sent this change request can withdraw it.',
          );
        }
        await tx.amendment.update({
          where: { id: a.id },
          data: { status: A.WITHDRAWN, decidedAt: now },
        });
        await this.events.record(tx, {
          contractId: contract.id,
          actorId: viewer.id,
          type: 'amendment_withdrawn',
          data: { amendmentId: a.id },
        });
      },
      notice: (contract) => ({
        kind: 'contract',
        step: 'amendment_withdrawn',
        title: 'Change request withdrawn',
        body: `${this.actorName(contract, viewer.id)} withdrew the change request on ${contract.title}.`,
      }),
    });
  }

  // ---------- Mutual end ----------

  /**
   * Either side: ask to end the contract together. When a milestone is SUBMITTED, the client must
   * say what happens to it (approve and pay, or refund) in the same step.
   */
  async requestEnd(
    contractId: number,
    viewer: ContractViewer,
    input: { note?: string; submittedChoice?: EndChoice },
  ) {
    const note = input.note?.trim() || null;
    return this.step.run(contractId, viewer, {
      message: 'End request sent',
      write: async ({ tx, contract, side, now }) => {
        this.assertActive(contract);
        if (contract.endRequestedById !== null) {
          throw new ConflictException('An end request is already open.');
        }
        const choice =
          side === 'client'
            ? this.clientChoice(contract, input.submittedChoice)
            : null;
        await tx.contract.update({
          where: { id: contract.id },
          data: {
            endRequestedById: viewer.id,
            endRequestNote: note,
            endRequestChoice: choice,
            endRequestedAt: now,
          },
        });
        await this.events.record(tx, {
          contractId: contract.id,
          actorId: viewer.id,
          type: 'end_requested',
          data: {
            ...(note ? { note } : {}),
            ...(choice ? { choice } : {}),
          },
        });
      },
      notice: (contract) => ({
        kind: 'contract',
        step: 'end_requested',
        title: 'End request',
        body: `${this.actorName(contract, viewer.id)} asked to end ${contract.title} together.${note ? ` ${note}` : ''}`,
        chat: this.chatFrom(
          contract,
          viewer.id,
          `I would like to end the contract for "${contract.title}" together.`,
        ),
      }),
    });
  }

  /** The other side: agree. The contract ends (MUTUAL); held credits go back, or are paid. */
  async acceptEnd(
    contractId: number,
    viewer: ContractViewer,
    input: { submittedChoice?: EndChoice },
  ) {
    return this.step.run(contractId, viewer, {
      message: 'Contract ended',
      write: async ({ tx, contract, side, now }) => {
        this.assertActive(contract);
        this.assertEndRequestOpen(contract);
        if (contract.endRequestedById === viewer.id) {
          throw new ForbiddenException(
            'Only the other person can accept this end request.',
          );
        }
        let choice: EndChoice | undefined;
        if (side === 'client') {
          // The client accepts the freelancer's request: the client picks for submitted work.
          choice =
            this.clientChoice(contract, input.submittedChoice) ?? undefined;
        } else {
          // The freelancer accepts the client's request: the client already picked (or nothing
          // was submitted then). Work submitted after the request needs a new request.
          choice = (contract.endRequestChoice as EndChoice | null) ?? undefined;
          if (!choice && hasSubmitted(contract)) {
            throw new ConflictException(
              'Work was submitted after the end request. Ask the client to send a new one.',
            );
          }
        }
        return this.ending.end(tx, contract, 'MUTUAL', {
          submittedChoice: choice,
          actorId: viewer.id,
          now,
        });
      },
      notice: (contract, result) => ({
        kind: 'contract',
        step: 'contract_ended',
        title: 'Contract ended',
        body: `${this.actorName(contract, viewer.id)} agreed to end ${contract.title}. ${endSummary(result)}`,
        chat: this.chatFrom(
          contract,
          viewer.id,
          `I agree. The contract for "${contract.title}" is ended.`,
        ),
      }),
    });
  }

  /** The other side: say no. */
  async declineEnd(contractId: number, viewer: ContractViewer) {
    return this.step.run(contractId, viewer, {
      message: 'End request declined',
      write: async ({ tx, contract }) => {
        this.assertActive(contract);
        this.assertEndRequestOpen(contract);
        if (contract.endRequestedById === viewer.id) {
          throw new ForbiddenException(
            'Only the other person can decline this end request.',
          );
        }
        await this.clearEndRequest(tx, contract.id);
        await this.events.record(tx, {
          contractId: contract.id,
          actorId: viewer.id,
          type: 'end_request_declined',
        });
      },
      notice: (contract) => ({
        kind: 'contract',
        step: 'end_request_declined',
        title: 'End request declined',
        body: `${this.actorName(contract, viewer.id)} declined to end ${contract.title}. The contract goes on.`,
      }),
    });
  }

  /** The asker: take the request back. */
  async withdrawEnd(contractId: number, viewer: ContractViewer) {
    return this.step.run(contractId, viewer, {
      message: 'End request withdrawn',
      write: async ({ tx, contract }) => {
        this.assertActive(contract);
        this.assertEndRequestOpen(contract);
        if (contract.endRequestedById !== viewer.id) {
          throw new ForbiddenException(
            'Only the person who sent this end request can withdraw it.',
          );
        }
        await this.clearEndRequest(tx, contract.id);
        await this.events.record(tx, {
          contractId: contract.id,
          actorId: viewer.id,
          type: 'end_request_withdrawn',
        });
      },
      notice: (contract) => ({
        kind: 'contract',
        step: 'end_request_withdrawn',
        title: 'End request withdrawn',
        body: `${this.actorName(contract, viewer.id)} withdrew the request to end ${contract.title}.`,
      }),
    });
  }

  // ---------- helpers ----------

  /** The contract id of an amendment (404 when there is no such amendment). */
  private async contractIdOfAmendment(amendmentId: number): Promise<number> {
    const a = await this.prisma.amendment.findUnique({
      where: { id: amendmentId },
      select: { contractId: true },
    });
    if (!a) {
      throw new NotFoundException(`Amendment with ID ${amendmentId} not found`);
    }
    return a.contractId;
  }

  /** The amendment read after the lock; it must be OPEN (409 otherwise) and on this contract. */
  private async openAmendment(
    tx: Prisma.TransactionClient,
    contract: LockedContract,
    amendmentId: number,
  ) {
    this.assertActive(contract);
    const a = await tx.amendment.findUnique({ where: { id: amendmentId } });
    if (!a || a.contractId !== contract.id) {
      throw new NotFoundException(`Amendment with ID ${amendmentId} not found`);
    }
    if (a.status !== A.OPEN)
      throw new ConflictException(AMENDMENT_CLOSED[a.status]);
    return a;
  }

  private assertActive(contract: LockedContract) {
    if (contract.status === C.ENDED) {
      throw new ConflictException('This contract has ended.');
    }
    if (contract.status === C.COMPLETED) {
      throw new ConflictException('This contract is completed.');
    }
  }

  private assertEndRequestOpen(contract: LockedContract) {
    if (contract.endRequestedById === null) {
      throw new ConflictException('There is no open end request.');
    }
  }

  /** The client's pick for submitted work: required (400) while a milestone is SUBMITTED. */
  private clientChoice(
    contract: LockedContract,
    choice: EndChoice | undefined,
  ): EndChoice | null {
    if (!hasSubmitted(contract)) return null;
    if (!choice) {
      throw new BadRequestException(
        'Choose approve or refund for the submitted work.',
      );
    }
    return choice;
  }

  private clearEndRequest(tx: Prisma.TransactionClient, contractId: number) {
    return tx.contract.update({
      where: { id: contractId },
      data: {
        endRequestedById: null,
        endRequestNote: null,
        endRequestChoice: null,
        endRequestedAt: null,
      },
    });
  }

  private actorName(contract: LockedContract, userId: number): string {
    return contract.clientId === userId
      ? contract.client.name
      : contract.freelancer.name;
  }

  private chatFrom(contract: LockedContract, fromId: number, text: string) {
    const toId =
      contract.clientId === fromId ? contract.freelancerId : contract.clientId;
    return { fromId, toId, text };
  }
}

function hasSubmitted(contract: LockedContract): boolean {
  return contract.milestones.some((m) => m.status === M.SUBMITTED);
}

function openAmendmentError() {
  return new ConflictException(
    'This contract already has an open change request.',
  );
}

/** The changes as saved in the JSON column (dates as ISO text, like AmendmentChange). */
function toJson(changes: AmendmentChangeParsed[]): Prisma.InputJsonValue {
  return changes.map((c) =>
    c.op === 'amount' ? c : { ...c, dueDate: c.dueDate.toISOString() },
  ) as unknown as Prisma.InputJsonValue;
}

function fromJson(c: AmendmentChange): AmendmentChangeParsed {
  return c.op === 'amount' ? c : { ...c, dueDate: new Date(c.dueDate) };
}

function describe(count: number, deadline: Date | undefined): string {
  const parts: string[] = [];
  if (count > 0) parts.push(`${count} change${count === 1 ? '' : 's'}`);
  if (deadline) parts.push('a new deadline');
  return parts.join(' and ');
}

function endSummary(r: {
  released: number[];
  refunded: number[];
  cancelled: number[];
}): string {
  const parts: string[] = [];
  if (r.released.length) parts.push(`Milestone ${r.released.join(', ')} paid.`);
  if (r.refunded.length) {
    parts.push(`Credits of milestone ${r.refunded.join(', ')} went back.`);
  }
  return parts.join(' ');
}

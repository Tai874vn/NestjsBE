/**
 * Core service for contract and milestone actions in the contracts module.
 * Handles funding milestones, submitting work, requesting changes, approving work, and client-only early contract endings.
 *
 * Calls: ContractStepService; WalletService; ContractEventsService; ContractEndingService; nextMilestoneStatus; prisma.milestone; prisma.submission; RedisService
 * Used by:
 *   - src/modules/contracts/contracts.module.ts
 *   - src/modules/contracts/controllers/contracts.controller.ts
 *   - src/modules/contracts/controllers/milestones.controller.ts
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { ContractStatus, MilestoneStatus, Prisma } from '@prisma/client';
import { RedisService } from '../../redis/services/redis.service';
import {
  MilestoneMove,
  WalletService,
} from '../../wallet/services/wallet.service';
import {
  fmtCredits,
  HELD_STATUSES,
  MilestoneAction,
  nextMilestoneStatus,
  Side,
} from '../utils/contract-rules';
import {
  CLEAR_END_CHOICE,
  ContractEndingService,
} from './contract-ending.service';
import { ContractEventsService } from './contract-events.service';
import {
  ContractStepService,
  ContractViewer,
  LockedContract,
  LockedMilestone,
  ruleToHttp,
} from './contract-step.service';
import { isOurImage, isWebLink } from '../dto/proposal.dto';

const M = MilestoneStatus;
const C = ContractStatus;

export const NOTE_MAX_LENGTH = 2000;
export const MAX_SUBMISSION_FILES = 10;

export type SubmitWorkInput = {
  note: string;
  images: string[];
  links: string[];
};

/** Setting these to null clears the three day-2 warning flags of a milestone. */
const NO_WARNINGS = {
  lateWarnedAt: null,
  silentWarnedAt: null,
  unfundedWarnedAt: null,
} satisfies Prisma.MilestoneUpdateInput;

/**
 * The contract and milestone actions: fund, submit work, request changes, approve, and the
 * client's own early end. Every one runs through ContractStepService.run() (contract row lock,
 * fresh read, side check, write, then notice after the save). The money moves go through
 * WalletService inside the same transaction, so a milestone change and its credits are saved
 * together or not at all.
 */
@Injectable()
export class ContractsService {
  constructor(
    private readonly step: ContractStepService,
    private readonly wallet: WalletService,
    private readonly events: ContractEventsService,
    private readonly ending: ContractEndingService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  /**
   * Client: hold the milestone's credits (FUND_HOLD). Only the next milestone in order, after the
   * one before is approved. A second Fund of the same milestone waits for the lock of the first,
   * then reads FUNDED and gets 409 "Milestone 1 is already funded." (only one hold).
   */
  async fund(milestoneId: number, viewer: ContractViewer) {
    const contractId = await this.step.contractIdOfMilestone(milestoneId);
    return this.step.run(contractId, viewer, {
      message: 'Milestone funded',
      write: async ({ tx, contract, side, now }) => {
        const m = this.checkAction('fund', contract, milestoneId, side);
        // Throws InsufficientCreditsError when the client has too few credits; run() turns it
        // into 409 with the exact sentence.
        await this.wallet.hold(tx, this.moveOf(contract, m));
        await tx.milestone.update({
          where: { id: m.id },
          data: { status: M.FUNDED, fundedAt: now, ...NO_WARNINGS },
        });
        await this.events.record(tx, {
          contractId: contract.id,
          actorId: viewer.id,
          type: 'milestone_funded',
          data: { milestoneId: m.id, position: m.position, amount: m.amount },
        });
        return m;
      },
      notice: (contract, m) => ({
        kind: 'contract',
        step: 'milestone_funded',
        title: 'Milestone funded',
        position: m.position,
        amount: m.amount,
        body: `${contract.client.name} funded milestone ${m.position} of ${contract.title} (${fmtCredits(m.amount)} credits). You can start the work.`,
        milestoneId: m.id,
        chat: {
          fromId: contract.clientId,
          toId: contract.freelancerId,
          text: `I funded milestone ${m.position} "${m.title}" (${fmtCredits(m.amount)} credits). You can start.`,
        },
      }),
    });
  }

  /** Freelancer: hand in work (a note, images and links). Each submission gets the next number. */
  async submit(
    milestoneId: number,
    viewer: ContractViewer,
    input: SubmitWorkInput,
  ) {
    const work = this.checkWork(input);
    const contractId = await this.step.contractIdOfMilestone(milestoneId);
    return this.step.run(contractId, viewer, {
      message: 'Work submitted',
      write: async ({ tx, contract, side, now }) => {
        const m = this.checkAction('submit', contract, milestoneId, side);
        const last = await tx.submission.findFirst({
          where: { milestoneId: m.id },
          orderBy: { number: 'desc' },
          select: { number: true },
        });
        const number = (last?.number ?? 0) + 1;
        await tx.submission.create({
          data: {
            milestoneId: m.id,
            number,
            authorId: viewer.id,
            note: work.note,
            images: work.images,
            links: work.links,
            createdAt: now,
          },
        });
        // A new submission restarts the client-silent clock and clears the warnings.
        await tx.milestone.update({
          where: { id: m.id },
          data: { status: M.SUBMITTED, submittedAt: now, ...NO_WARNINGS },
        });
        await this.clearEndChoice(tx, contract);
        await this.events.record(tx, {
          contractId: contract.id,
          actorId: viewer.id,
          type: 'work_submitted',
          data: { milestoneId: m.id, position: m.position, submission: number },
        });
        return { m, number };
      },
      notice: (contract, { m, number }) => ({
        kind: 'contract',
        step: 'work_submitted',
        title: 'Work submitted',
        position: m.position,
        body: `${contract.freelancer.name} submitted work for milestone ${m.position} of ${contract.title}. Review it and approve or ask for changes.`,
        milestoneId: m.id,
        chat: {
          fromId: contract.freelancerId,
          toId: contract.clientId,
          text:
            number === 1
              ? `I submitted the work for milestone ${m.position} "${m.title}".`
              : `I submitted version ${number} of the work for milestone ${m.position} "${m.title}".`,
        },
      }),
    });
  }

  /** Client: send the work back with a note. The note is saved on the latest submission. */
  async requestChanges(
    milestoneId: number,
    viewer: ContractViewer,
    note: string,
  ) {
    const feedback = this.checkNote(note);
    const contractId = await this.step.contractIdOfMilestone(milestoneId);
    return this.step.run(contractId, viewer, {
      message: 'Changes requested',
      write: async ({ tx, contract, side, now }) => {
        const m = this.checkAction(
          'requestChanges',
          contract,
          milestoneId,
          side,
        );
        const latest = await tx.submission.findFirst({
          where: { milestoneId: m.id },
          orderBy: { number: 'desc' },
          select: { id: true },
        });
        if (latest) {
          await tx.submission.update({
            where: { id: latest.id },
            data: { feedback },
          });
        }
        // The freelancer-late clock restarts from now; the warnings are cleared.
        await tx.milestone.update({
          where: { id: m.id },
          data: {
            status: M.CHANGES_REQUESTED,
            changesRequestedAt: now,
            ...NO_WARNINGS,
          },
        });
        await this.clearEndChoice(tx, contract);
        await this.events.record(tx, {
          contractId: contract.id,
          actorId: viewer.id,
          type: 'changes_requested',
          data: { milestoneId: m.id, position: m.position, note: feedback },
        });
        return m;
      },
      notice: (contract, m) => ({
        kind: 'contract',
        step: 'changes_requested',
        title: 'Changes requested',
        position: m.position,
        body: `${contract.client.name} asked for changes on milestone ${m.position} of ${contract.title}: ${feedback}`,
        milestoneId: m.id,
      }),
    });
  }

  /**
   * Client: accept the work. The held credits go to the freelancer (RELEASE). When it was the
   * last milestone, the contract is COMPLETED.
   */
  async approve(milestoneId: number, viewer: ContractViewer) {
    const contractId = await this.step.contractIdOfMilestone(milestoneId);
    return this.step.run(contractId, viewer, {
      message: 'Milestone approved',
      write: async ({ tx, contract, side, now }) => {
        const m = this.checkAction('approve', contract, milestoneId, side);
        const { completed } = await this.ending.approveMilestone(
          tx,
          contract,
          m,
          { actorId: viewer.id, now, auto: false },
        );
        return { m, completed };
      },
      afterCommit: async (contract, { completed }) => {
        if (completed) {
          // Completed hire count on the freelancer's public profile changed.
          await this.redisService?.invalidateUserProfile(contract.freelancerId);
        }
      },
      notice: (contract, { m, completed }) => {
        const paid = `${fmtCredits(m.amount)} credits`;
        return {
          kind: 'contract',
          step: completed ? 'contract_completed' : 'milestone_approved',
          title: completed ? 'Contract completed' : 'Milestone approved',
          body: completed
            ? `${contract.client.name} approved the last milestone of ${contract.title} (${paid} paid). The contract is completed.`
            : `${contract.client.name} approved milestone ${m.position} of ${contract.title} (${paid} paid).`,
          milestoneId: m.id,
          position: m.position,
          amount: m.amount,
          chat: {
            fromId: contract.clientId,
            toId: contract.freelancerId,
            text: completed
              ? `I approved milestone ${m.position} "${m.title}" (${paid}). The contract is completed. Thank you!`
              : `I approved milestone ${m.position} "${m.title}" (${paid}).`,
          },
        };
      },
    });
  }

  /**
   * Client: stop the contract alone (CLIENT_ENDED). Only while no credits are held; otherwise the
   * two sides end it together (end requests) so the freelancer is not left unpaid.
   */
  async end(contractId: number, viewer: ContractViewer) {
    return this.step.run(contractId, viewer, {
      message: 'Contract ended',
      write: async ({ tx, contract, side, now }) => {
        this.assertActive(contract);
        if (side !== 'client') {
          throw new ForbiddenException(
            'Only the client can end the contract alone. Ask the client to end it together.',
          );
        }
        if (contract.milestones.some((m) => HELD_STATUSES.includes(m.status))) {
          throw new ConflictException(
            'Credits are held on this contract. Ask the freelancer to end it instead.',
          );
        }
        await this.ending.end(tx, contract, 'CLIENT_ENDED', {
          actorId: viewer.id,
          now,
        });
      },
      notice: (contract) => ({
        kind: 'contract',
        step: 'contract_ended',
        title: 'Contract ended',
        rule: 'CLIENT_ENDED',
        body: `${contract.client.name} ended the contract for ${contract.title}. No credits were held.`,
        chat: {
          fromId: contract.clientId,
          toId: contract.freelancerId,
          text: `I ended the contract for "${contract.title}".`,
        },
      }),
    });
  }

  /** The milestone (read after the lock) and the rule check of the action (403/409). */
  private checkAction(
    action: MilestoneAction,
    contract: LockedContract,
    milestoneId: number,
    side: Side,
  ): LockedMilestone {
    const m = contract.milestones.find((x) => x.id === milestoneId);
    if (!m) {
      throw new NotFoundException(`Milestone with ID ${milestoneId} not found`);
    }
    const previous =
      contract.milestones.find((x) => x.position === m.position - 1) ?? null;
    ruleToHttp(() =>
      nextMilestoneStatus(action, side, m, {
        contractStatus: contract.status,
        previous,
      }),
    );
    return m;
  }

  /**
   * The work changed, so the client's stored end-request choice (made for the old work) is
   * dropped. Accepting that end request while work is SUBMITTED then needs a new request.
   */
  private async clearEndChoice(
    tx: Prisma.TransactionClient,
    contract: LockedContract,
  ) {
    if (!contract.endRequestChoice) return;
    await tx.contract.update({
      where: { id: contract.id },
      data: CLEAR_END_CHOICE,
    });
  }

  private assertActive(contract: LockedContract) {
    if (contract.status === C.ENDED) {
      throw new ConflictException('This contract has ended.');
    }
    if (contract.status === C.COMPLETED) {
      throw new ConflictException('This contract is completed.');
    }
  }

  private moveOf(contract: LockedContract, m: LockedMilestone): MilestoneMove {
    return {
      clientId: contract.clientId,
      freelancerId: contract.freelancerId,
      amount: m.amount,
      contractId: contract.id,
      milestoneId: m.id,
    };
  }

  /** A note is 1 to 2000 characters after trimming (400 naming the field otherwise). */
  private checkNote(note: unknown): string {
    const text = typeof note === 'string' ? note.trim() : '';
    if (text.length < 1 || text.length > NOTE_MAX_LENGTH) {
      throw new BadRequestException('note must be 1 to 2000 characters.');
    }
    return text;
  }

  /**
   * The work of a submission. The DTO checks the same; this second check keeps the rule in the
   * service too: images only from JobAura local storage, links only http/https (so never
   * `javascript:`), at most 10 of each.
   */
  private checkWork(input: SubmitWorkInput): SubmitWorkInput {
    const note = this.checkNote(input.note);
    const images = input.images ?? [];
    const links = input.links ?? [];
    if (images.length > MAX_SUBMISSION_FILES || !images.every(isOurImage)) {
      throw new BadRequestException(
        'images must be up to 10 images uploaded through JobAura.',
      );
    }
    if (links.length > MAX_SUBMISSION_FILES || !links.every(isWebLink)) {
      throw new BadRequestException('links must be up to 10 web links.');
    }
    return { note, images, links };
  }
}

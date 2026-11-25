import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ContractStatus,
  MilestoneStatus,
  ProposalStatus,
} from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { PrismaService } from '../../prisma.service';
import { RedisService } from '../redis/redis.service';
import { fmtCredits } from './contract-rules';
import { ContractEndingService, EndResult } from './contract-ending.service';
import {
  ContractAnnounceInput,
  ContractEventsService,
} from './contract-events.service';
import {
  ContractStepService,
  LockedContract,
  LockedMilestone,
} from './contract-step.service';
import { DeadlineRule, evaluateDeadlines, ruleClock } from './deadline-rules';

const M = MilestoneStatus;
const C = ContractStatus;
const P = ProposalStatus;

/** How many rows one database read takes (proposals, then contracts). */
const BATCH_SIZE = 100;
/** Default length of every 3-day window, in minutes (CONTRACT_GRACE_MINUTES). */
const DEFAULT_GRACE_MINUTES = 4320;
/** Default time between two passes (CONTRACT_SWEEP_INTERVAL_MS); 0 turns the timer off. */
const DEFAULT_INTERVAL_MS = 60_000;
/** The name shown as the "actor" of sweeper notices (no person acted). */
const SYSTEM_NAME = 'JobAura';
/** Contracts with a milestone in one of these may have a deadline rule to apply. */
const SWEEP_STATUSES: MilestoneStatus[] = [
  M.FUNDED,
  M.SUBMITTED,
  M.CHANGES_REQUESTED,
  M.PENDING,
];

export type SweepResult = {
  expired: number;
  warned: number;
  ended: number;
  completed: number;
};

/** Which day-2 warning flag (a date column) belongs to which rule. */
const WARNING_FLAG = {
  CLIENT_SILENT: 'silentWarnedAt',
  FREELANCER_LATE: 'lateWarnedAt',
  NOT_FUNDED: 'unfundedWarnedAt',
} as const satisfies Record<DeadlineRule, keyof LockedMilestone>;

/** What one contract step of the sweeper did, for the notices after the save. */
type ContractOutcome =
  | { act: 'warn'; rule: DeadlineRule; m: LockedMilestone; left: number }
  | { act: 'completed'; m: LockedMilestone }
  | { act: 'ended'; rule: DeadlineRule; m: LockedMilestone; end: EndResult };

/** "3 days", "5 hours", "10 minutes": a time span rounded for people to read. */
export function fmtDuration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.round(minutes / 60);
  const plural = (n: number, word: string) =>
    `${n} ${word}${n === 1 ? '' : 's'}`;
  if (hours >= 24) return plural(Math.round(minutes / 1440), 'day');
  if (hours >= 1 && minutes >= 60) return plural(hours, 'hour');
  return plural(minutes, 'minute');
}

/**
 * The sweeper: a background job that runs every minute (a timer, no job framework) and applies
 * the deadline rules of spec 4.5, plus the 7-day proposal expiry.
 *
 * One pass (sweepOnce):
 *  1. OPEN proposals past their expiresAt become EXPIRED (both sides are told).
 *  2. Each ACTIVE contract that has a milestone in FUNDED, SUBMITTED, CHANGES_REQUESTED or PENDING
 *     (oldest updatedAt first) is checked with evaluateDeadlines() (deadline-rules.ts). At most
 *     one rule per contract per pass: a day-2 warning (sent once, a flag on the milestone records
 *     it), or the end of the window (auto-approve for a silent client, or ContractEndingService).
 *  3. A failure on one row is logged and the pass goes on with the next.
 *
 * Races (two things at the same moment): every change locks the row first with
 * SELECT ... FOR UPDATE ("this row is mine until the transaction ends"), the same lock that the
 * user actions take (ContractStepService.lockContract), and then reads the row AGAIN and decides
 * again. So when the client presses Approve in the same second, one of the two waits for the
 * other: if the client was first, the sweeper reads APPROVED and does nothing (one RELEASE only).
 *
 * Notifications and chat lines are sent after the save (commit). Sweeper chat lines are sent as
 * the client and start with "JobAura:".
 */
@Injectable()
export class ContractSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ContractSweeperService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly step: ContractStepService,
    private readonly events: ContractEventsService,
    private readonly ending: ContractEndingService,
    private readonly config: ConfigService,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  // onModuleInit / onModuleDestroy are lifecycle hooks (functions NestJS calls when the app
  // starts and stops). Unit tests build the service by hand, so the timer never starts there.
  onModuleInit() {
    const intervalMs = Number(
      this.config.get<string | number>('CONTRACT_SWEEP_INTERVAL_MS') ??
        DEFAULT_INTERVAL_MS,
    );
    if (intervalMs > 0) {
      this.timer = setInterval(() => void this.sweepOnce(), intervalMs);
      // unref: the timer alone does not keep the process alive.
      this.timer.unref?.();
    }
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass; returns what it did (for tests and logs). Skips when a pass is already running. */
  async sweepOnce(now: Date = new Date()): Promise<SweepResult> {
    const result: SweepResult = {
      expired: 0,
      warned: 0,
      ended: 0,
      completed: 0,
    };
    if (this.running) return result;
    this.running = true;
    try {
      result.expired = await this.expireProposals(now);
      await this.sweepContracts(now, this.graceMinutes(), result);
      if (result.expired + result.warned + result.ended + result.completed) {
        this.logger.log(
          `Sweep: ${result.expired} expired, ${result.warned} warned, ${result.ended} ended, ${result.completed} completed`,
        );
      }
    } catch (error) {
      this.logger.error(
        'Contract sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
      Sentry.captureException(error, {
        tags: { context: 'contract-sweeper' },
      });
    } finally {
      this.running = false;
    }
    return result;
  }

  private graceMinutes(): number {
    const value = Number(
      this.config.get<string | number>('CONTRACT_GRACE_MINUTES') ??
        DEFAULT_GRACE_MINUTES,
    );
    return Number.isInteger(value) && value >= 1
      ? value
      : DEFAULT_GRACE_MINUTES;
  }

  // ---------------------------------------------------------------------------------------
  // 1. Proposals
  // ---------------------------------------------------------------------------------------

  /** OPEN proposals past their 7 days → EXPIRED, 100 per read. Returns how many. */
  private async expireProposals(now: Date): Promise<number> {
    let expired = 0;
    let afterId = 0;
    for (;;) {
      const batch = await this.prisma.proposal.findMany({
        where: { status: P.OPEN, expiresAt: { lt: now }, id: { gt: afterId } },
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: { id: true },
      });
      for (const { id } of batch) {
        try {
          if (await this.expireProposal(id, now)) expired++;
        } catch (error) {
          this.logFailure(`proposal ${id}`, error);
        }
      }
      if (batch.length < BATCH_SIZE) return expired;
      afterId = batch[batch.length - 1].id;
    }
  }

  private async expireProposal(id: number, now: Date): Promise<boolean> {
    const proposal = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "proposals" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.proposal.findUnique({
        where: { id },
        include: {
          job: { select: { id: true, title: true } },
          client: { select: { id: true, name: true } },
          freelancer: { select: { id: true, name: true } },
        },
      });
      // Re-check after the lock: it may have been answered (new version, accept...) meanwhile.
      if (!row || row.status !== P.OPEN || row.expiresAt >= now) return null;
      await tx.proposal.update({
        where: { id },
        data: { status: P.EXPIRED, turnUserId: null, decidedAt: now },
      });
      await this.events.record(tx, {
        proposalId: id,
        actorId: null,
        type: 'proposal_expired',
      });
      return row;
    });
    if (!proposal) return false;

    // After commit: tell both sides. announce() never throws.
    const body = `The proposal for ${proposal.job.title} expired after 7 days without an answer.`;
    for (const side of ['client', 'freelancer'] as const) {
      await this.events.announce({
        recipientId:
          side === 'client' ? proposal.clientId : proposal.freelancerId,
        actorId: null,
        actorName: SYSTEM_NAME,
        kind: 'proposal',
        step: 'proposal_expired',
        jobTitle: proposal.job.title,
        title: 'Proposal expired',
        body,
        proposalId: proposal.id,
        recipientSide: side,
      });
    }
    return true;
  }

  // ---------------------------------------------------------------------------------------
  // 2. Contracts
  // ---------------------------------------------------------------------------------------

  /**
   * Reads the candidate contracts 100 at a time, oldest updatedAt first, and checks each one.
   * It goes on to the next 100 until all are read, so contracts with nothing to do at the front
   * of the list never keep the later ones waiting.
   */
  private async sweepContracts(
    now: Date,
    grace: number,
    result: SweepResult,
  ): Promise<void> {
    const seen = new Set<number>();
    let cursor: { updatedAt: Date; id: number } | null = null;
    for (;;) {
      const batch: { id: number; updatedAt: Date }[] =
        await this.prisma.contract.findMany({
          where: {
            status: C.ACTIVE,
            milestones: { some: { status: { in: SWEEP_STATUSES } } },
            ...(cursor
              ? {
                  OR: [
                    { updatedAt: { gt: cursor.updatedAt } },
                    { updatedAt: cursor.updatedAt, id: { gt: cursor.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
          take: BATCH_SIZE,
          select: { id: true, updatedAt: true },
        });
      for (const { id } of batch) {
        // A contract this pass already touched may show up again (its updatedAt moved).
        if (seen.has(id)) continue;
        seen.add(id);
        try {
          const outcome = await this.sweepContract(id, now, grace);
          if (outcome?.act === 'warn') result.warned++;
          if (outcome?.act === 'ended') result.ended++;
          if (outcome?.act === 'completed') result.completed++;
        } catch (error) {
          this.logFailure(`contract ${id}`, error);
        }
      }
      if (batch.length < BATCH_SIZE) return;
      cursor = batch[batch.length - 1];
    }
  }

  /** Lock, read again, decide again, write; then the notices. Null when nothing was due. */
  private async sweepContract(
    contractId: number,
    now: Date,
    grace: number,
  ): Promise<ContractOutcome | null> {
    const done = await this.prisma.$transaction(async (tx) => {
      // The same lock as every user action, then a fresh read.
      const contract = await this.step.lockContract(tx, contractId);
      const decision = evaluateDeadlines(contract, now, grace);
      if (!decision) return null;
      const m = contract.milestones.find((x) => x.id === decision.milestoneId)!;
      const ids = { milestoneId: m.id, position: m.position };
      let outcome: ContractOutcome;

      if (decision.act === 'warn') {
        // The flag makes sure each warning is sent only once.
        await tx.milestone.update({
          where: { id: m.id },
          data: { [WARNING_FLAG[decision.rule]]: now },
        });
        await this.events.record(tx, {
          contractId: contract.id,
          actorId: null,
          type: 'warning_sent',
          data: { rule: decision.rule, ...ids },
        });
        const { endAt } = ruleClock(decision.rule, contract, m, grace);
        outcome = {
          act: 'warn',
          rule: decision.rule,
          m,
          left: endAt.getTime() - now.getTime(),
        };
      } else if (decision.rule === 'CLIENT_SILENT') {
        outcome = await this.autoApprove(tx, contract, m, now);
      } else {
        const end = await this.ending.end(tx, contract, decision.rule, {
          actorId: null,
          now,
        });
        outcome = { act: 'ended', rule: decision.rule, m, end };
      }

      // The list shows the latest activity first.
      await tx.contract.update({
        where: { id: contract.id },
        data: { updatedAt: now },
      });
      return { contract, outcome };
    });
    if (!done) return null;

    // After commit: clear the freelancer's public profile cache when a contract completes.
    if (done.outcome.act === 'completed') {
      await this.redisService?.invalidateUserProfile(
        done.contract.freelancerId,
      );
    }

    // After commit. announce() never throws.
    for (const notice of this.notices(done.contract, done.outcome, grace)) {
      await this.events.announce(notice);
    }
    return done.outcome;
  }

  /**
   * The client did not answer a submission in time: release the credits (RELEASE) and mark the
   * milestone APPROVED with autoApproved = true. The contract is COMPLETED when it was the last
   * open milestone, otherwise it is ENDED (CLIENT_SILENT) and the rest is cancelled.
   */
  private async autoApprove(
    tx: Parameters<ContractEndingService['end']>[0],
    contract: LockedContract,
    m: LockedMilestone,
    now: Date,
  ): Promise<ContractOutcome> {
    // The same approve path as the client's Approve (ContractEndingService.approveMilestone).
    const { completed } = await this.ending.approveMilestone(tx, contract, m, {
      actorId: null,
      now,
      auto: true,
    });
    if (completed) return { act: 'completed', m };
    // Ending must see this milestone as APPROVED, so it is not refunded.
    const end = await this.ending.end(
      tx,
      {
        ...contract,
        milestones: contract.milestones.map((x) =>
          x.id === m.id ? { ...x, status: M.APPROVED } : x,
        ),
      },
      'CLIENT_SILENT',
      { actorId: null, now },
    );
    return { act: 'ended', rule: 'CLIENT_SILENT', m, end };
  }

  /** The notifications (and at most one chat line) of a sweeper step. */
  private notices(
    contract: LockedContract,
    outcome: ContractOutcome,
    grace: number,
  ): ContractAnnounceInput[] {
    const { m } = outcome;
    const window = fmtDuration(grace * 60_000);
    const paid = `${fmtCredits(m.amount)} credits`;
    const base = {
      actorId: null,
      actorName: SYSTEM_NAME,
      kind: 'contract' as const,
      contractId: contract.id,
      milestoneId: m.id,
      jobTitle: contract.job.title,
      position: m.position,
    };
    const toClient = {
      recipientId: contract.clientId,
      recipientSide: 'client' as const,
    };
    const toFreelancer = {
      recipientId: contract.freelancerId,
      recipientSide: 'freelancer' as const,
    };
    // Sweeper chat lines are sent as the client and start with "JobAura:".
    const chat = (text: string) => ({
      fromId: contract.clientId,
      toId: contract.freelancerId,
      text: `JobAura: ${text}`,
    });

    if (outcome.act === 'warn') {
      const left = fmtDuration(outcome.left);
      const notice = {
        ...base,
        step: 'warning_sent' as const,
        rule: outcome.rule.toLowerCase(),
      };
      if (outcome.rule === 'FREELANCER_LATE') {
        const body = `Milestone ${m.position} is past its due date. ${left} left to submit.`;
        return [toClient, toFreelancer].map((to) => ({
          ...notice,
          ...to,
          title: 'Due date passed',
          body,
        }));
      }
      if (outcome.rule === 'CLIENT_SILENT') {
        return [
          {
            ...notice,
            ...toClient,
            title: 'Review the submission',
            body: `Milestone ${m.position} of ${contract.title} is waiting for your review. If you do not answer within ${left}, it is approved automatically.`,
          },
        ];
      }
      return [
        {
          ...notice,
          ...toClient,
          title: 'Fund the next milestone',
          body: `Milestone ${m.position} of ${contract.title} is not funded yet. Fund it within ${left}, or the contract ends.`,
        },
      ];
    }

    if (outcome.act === 'completed') {
      const body = `Milestone ${m.position} of ${contract.title} was approved automatically after ${window} without a review (${paid} paid). The contract is completed.`;
      return [
        {
          ...base,
          ...toFreelancer,
          step: 'contract_completed',
          amount: m.amount,
          title: 'Contract completed',
          body,
          chat: chat(
            `milestone ${m.position} "${m.title}" was approved automatically (${paid}). The contract is completed.`,
          ),
        },
        {
          ...base,
          ...toClient,
          step: 'contract_completed',
          amount: m.amount,
          title: 'Contract completed',
          body,
        },
      ];
    }

    const refunded = outcome.end.refunded.length
      ? ` Held credits for milestone ${outcome.end.refunded.join(', ')} went back to the client.`
      : '';
    const why =
      outcome.rule === 'CLIENT_SILENT'
        ? `milestone ${m.position} was approved automatically after ${window} without a review (${paid} paid), and the contract ended.`
        : outcome.rule === 'FREELANCER_LATE'
          ? `milestone ${m.position} was not submitted within ${window} after its due date, so the contract ended.${refunded}`
          : `milestone ${m.position} was not funded within ${window}, so the contract ended.`;
    const body = `${contract.title}: ${why} Approved work stays with the client.`;
    const moved =
      outcome.rule === 'CLIENT_SILENT' ? m.amount : outcome.end.refundedAmount;
    const ended = {
      ...base,
      rule: outcome.rule,
      ...(moved > 0 ? { amount: moved } : {}),
    };
    return [
      {
        ...ended,
        ...toFreelancer,
        step: 'contract_ended',
        title: 'Contract ended',
        body,
        chat: chat(`the contract for "${contract.title}" ended: ${why}`),
      },
      {
        ...ended,
        ...toClient,
        step: 'contract_ended',
        title: 'Contract ended',
        body,
      },
    ];
  }

  private logFailure(where: string, error: unknown) {
    this.logger.error(
      `Sweep of ${where} failed: ${error instanceof Error ? error.message : String(error)}`,
      error instanceof Error ? error.stack : undefined,
    );
    Sentry.captureException(error, {
      tags: { context: 'contract-sweeper.item' },
    });
  }
}

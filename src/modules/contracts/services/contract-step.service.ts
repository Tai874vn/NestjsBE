import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Role } from '../../../common/constants/roles';
import { PrismaService } from '../../../prisma.service';
import { InsufficientCreditsError } from '../../wallet/services/wallet.service';
import { RuleError, Side } from '../utils/contract-rules';
import {
  ContractAnnounceInput,
  ContractEventsService,
} from './contract-events.service';
import { ContractDetail } from '../utils/contract-views';
import { ContractsQueryService } from './contracts-query.service';

/** The signed-in user. role is only read to let an admin open a contract page. */
export type ContractViewer = { id: number; role?: Role };

/** What every contract step reads after locking the contract row. */
export const lockedContractInclude = {
  job: { select: { id: true, title: true } },
  client: { select: { id: true, name: true } },
  freelancer: { select: { id: true, name: true } },
  milestones: { orderBy: { position: 'asc' } },
} satisfies Prisma.ContractInclude;

export type LockedContract = Prisma.ContractGetPayload<{
  include: typeof lockedContractInclude;
}>;
export type LockedMilestone = LockedContract['milestones'][number];

export type ContractStepInput = {
  tx: Prisma.TransactionClient;
  contract: LockedContract;
  side: Side;
  now: Date;
};

/** The notification of a step, without the parts run() fills in. */
export type ContractStepNotice = Omit<
  ContractAnnounceInput,
  'recipientId' | 'actorId' | 'actorName' | 'contractId' | 'recipientSide'
>;

export type ContractStep<R> = {
  /** Write the change and its history rows; the result goes to notice(). */
  write: (input: ContractStepInput) => Promise<R>;
  /** What the other side is told after the save (null: nothing). */
  notice: (contract: LockedContract, result: R) => ContractStepNotice | null;
  /** Optional post-commit side effect (for example cache invalidation). */
  afterCommit?: (contract: LockedContract, result: R) => Promise<void>;
  message: string;
};

/** Rule errors become 403 (wrong person), 409 (wrong state) or 400 (bad input). */
export function ruleToHttp(check: () => void): void {
  try {
    check();
  } catch (error) {
    if (error instanceof RuleError) {
      if (error.kind === 'forbidden') {
        throw new ForbiddenException(error.message);
      }
      if (error.kind === 'conflict') throw new ConflictException(error.message);
      throw new BadRequestException(error.message);
    }
    throw error;
  }
}

/** Which side the user is on, or 403 for anyone else. */
export function contractSideOrThrow(
  contract: { clientId: number; freelancerId: number },
  userId: number,
): Side {
  if (contract.clientId === userId) return 'client';
  if (contract.freelancerId === userId) return 'freelancer';
  throw new ForbiddenException('This contract is not yours.');
}

/**
 * The shared steps of every action on a contract (fund, submit, approve, end, amendments...):
 *  1. A transaction (a group of database changes saved together or not at all) locks the contract
 *     row with SELECT ... FOR UPDATE ("this row is mine until the transaction ends"). The wallets
 *     are locked after it (WalletService, ascending user id), so the lock order is always the same.
 *  2. It reads the contract and its milestones AGAIN after the lock. So when the client presses
 *     Fund twice, the second request waits for the first, then sees FUNDED and gets 409; and when
 *     the client approves while the sweeper auto-approves, the second one sees APPROVED.
 *  3. Only the client or the freelancer may act (anyone else 403).
 *  4. step.write() changes the rows and writes the history rows (ContractEvent).
 *  5. After the save (commit), the other side gets a notification (and maybe a chat line).
 */
@Injectable()
export class ContractStepService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: ContractEventsService,
    private readonly query: ContractsQueryService,
  ) {}

  async run<R>(
    contractId: number,
    viewer: ContractViewer,
    step: ContractStep<R>,
  ): Promise<{ message: string; content: ContractDetail }> {
    const { contract, side, result } = await this.prisma.$transaction(
      async (tx) => {
        const contract = await this.lockContract(tx, contractId);
        const side = contractSideOrThrow(contract, viewer.id);
        const now = new Date();
        let result: R;
        try {
          result = await step.write({ tx, contract, side, now });
        } catch (error) {
          // Too few credits: 409 with the sentence the user sees.
          if (error instanceof InsufficientCreditsError) throw error.toHttp();
          throw error;
        }
        // The list shows the latest activity first.
        await tx.contract.update({
          where: { id: contract.id },
          data: { updatedAt: now },
        });
        return { contract, side, result };
      },
    );

    // After commit: run optional post-commit hooks and tell the other side. announce() never throws.
    if (step.afterCommit) {
      await step.afterCommit(contract, result);
    }
    const notice = step.notice(contract, result);
    if (notice) {
      const client = side === 'client';
      await this.events.announce({
        jobTitle: contract.job.title,
        ...notice,
        recipientId: client ? contract.freelancerId : contract.clientId,
        actorId: viewer.id,
        actorName: client ? contract.client.name : contract.freelancer.name,
        contractId: contract.id,
        recipientSide: client ? 'freelancer' : 'client',
      });
    }

    return {
      message: step.message,
      content: await this.query.detail(contractId, viewer),
    };
  }

  /** The contract id of a milestone (404 when there is no such milestone). */
  async contractIdOfMilestone(milestoneId: number): Promise<number> {
    const milestone = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: { contractId: true },
    });
    if (!milestone) {
      throw new NotFoundException(`Milestone with ID ${milestoneId} not found`);
    }
    return milestone.contractId;
  }

  /** Locks the contract row, then reads it (and its milestones) fresh. */
  async lockContract(
    tx: Prisma.TransactionClient,
    contractId: number,
  ): Promise<LockedContract> {
    await tx.$queryRaw`SELECT id FROM "contracts" WHERE id = ${contractId} FOR UPDATE`;
    const contract = await tx.contract.findUnique({
      where: { id: contractId },
      include: lockedContractInclude,
    });
    if (!contract) {
      throw new NotFoundException(`Contract with ID ${contractId} not found`);
    }
    return contract;
  }
}

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ContractStatus, Prisma } from '@prisma/client';
import { Role } from '../../common/constants/roles';
import { PrismaService } from '../../prisma.service';
import { Paginated } from '../wallet/wallet.service';
import { Side } from './contract-rules';
import {
  ContractDetail,
  contractDetailInclude,
  contractDetailView,
  contractEventInclude,
  ContractListItem,
  contractListInclude,
  contractListItemView,
} from './contract-views';

/** Every 3-day window of the deadline rules, in minutes (4320 = 3 days). */
export const DEFAULT_GRACE_MINUTES = 4320;

/**
 * CONTRACT_GRACE_MINUTES from the environment (a whole number of at least 1), else 4320.
 * The demo sets it low (for example 5) so the deadline rules can be shown in minutes.
 */
export function graceMinutes(): number {
  const value = Number(process.env.CONTRACT_GRACE_MINUTES);
  return Number.isInteger(value) && value >= 1 ? value : DEFAULT_GRACE_MINUTES;
}

export type ContractListQuery = {
  role: Side;
  status?: ContractStatus;
  page: number;
  pageSize: number;
};

/** Reading contracts: the list and the detail page. Nothing here changes data. */
@Injectable()
export class ContractsQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** role=client: contracts where I pay; role=freelancer: contracts where I work. Latest activity first. */
  async list(
    viewer: { id: number },
    query: ContractListQuery,
  ): Promise<{ message: string; content: Paginated<ContractListItem> }> {
    const where: Prisma.ContractWhereInput = {
      ...(query.role === 'client'
        ? { clientId: viewer.id }
        : { freelancerId: viewer.id }),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.contract.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: contractListInclude,
      }),
      this.prisma.contract.count({ where }),
    ]);
    return {
      message: 'Contracts fetched',
      content: {
        data: rows.map((row) => contractListItemView(row, query.role)),
        total,
        page: query.page,
        pageSize: query.pageSize,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async findOne(id: number, viewer: { id: number; role?: Role }) {
    return {
      message: 'Contract fetched',
      content: await this.detail(id, viewer),
    };
  }

  /**
   * The contract page for its client or freelancer (an admin may read it too, seen as the
   * client side). Anyone else gets 403. Every submission of every milestone is in it, also after
   * the contract ended (the client keeps read access forever).
   */
  async detail(
    id: number,
    viewer: { id: number; role?: Role },
  ): Promise<ContractDetail> {
    const row = await this.prisma.contract.findUnique({
      where: { id },
      include: contractDetailInclude,
    });
    if (!row) throw new NotFoundException(`Contract with ID ${id} not found`);
    let role: Side;
    if (row.clientId === viewer.id) role = 'client';
    else if (row.freelancerId === viewer.id) role = 'freelancer';
    else if (viewer.role === Role.ADMIN) role = 'client';
    else throw new ForbiddenException('This contract is not yours.');

    // The proposal's rows (sent, countered, accepted) come before the contract's own rows.
    const events = await this.prisma.contractEvent.findMany({
      where: {
        OR: [
          { contractId: id },
          ...(row.proposalId !== null ? [{ proposalId: row.proposalId }] : []),
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: contractEventInclude,
    });
    return contractDetailView(
      row,
      events,
      { id: viewer.id, role },
      graceMinutes(),
    );
  }
}

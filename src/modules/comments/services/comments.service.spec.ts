import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ContractStatus, MilestoneStatus, Prisma } from '@prisma/client';
import { CommentsService } from './comments.service';

const client = 3;
const freelancer = 9;

function contract(
  status: ContractStatus,
  milestones: MilestoneStatus[] = [MilestoneStatus.APPROVED],
) {
  return {
    id: 20,
    jobId: 10,
    clientId: client,
    freelancerId: freelancer,
    status,
    title: 'Logo design',
    client: { id: client, name: 'Client C' },
    freelancer: { id: freelancer, name: 'Free F' },
    job: { id: 10, title: 'Logo design' },
    milestones: milestones.map((s, i) => ({ id: i + 1, status: s })),
  };
}

const createService = (found: ReturnType<typeof contract> | null) => {
  const created = {
    id: 1,
    jobId: 10,
    contractId: 20,
    job: { id: 10, creatorId: freelancer },
  };
  const tx = {
    comment: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(created),
    },
  };
  const prisma = {
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const redis = {
    invalidateCommentCaches: jest.fn(),
    invalidateUserCaches: jest.fn(),
  };
  const steps = {
    lockContract: jest.fn().mockImplementation(() => {
      if (!found) throw new NotFoundException('Contract with ID 20 not found');
      return Promise.resolve(found);
    }),
  };
  const events = { record: jest.fn(), announce: jest.fn() };
  const service = new CommentsService(
    prisma as never,
    redis as never,
    steps as never,
    events as never,
  );
  return { service, tx, redis, events };
};

const dto = { contractId: 20, content: 'Great work', rating: 5 };

describe('CommentsService review from a contract', () => {
  it('only the client may review (403)', async () => {
    const { service, tx } = createService(contract(ContractStatus.COMPLETED));
    const error = await service.create(dto, freelancer).catch((e) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.message).toBe('Only the client can review this contract.');
    expect(tx.comment.create).not.toHaveBeenCalled();
  });

  it('an ACTIVE contract cannot be reviewed yet (409)', async () => {
    const { service } = createService(
      contract(ContractStatus.ACTIVE, [MilestoneStatus.APPROVED]),
    );
    const error = await service.create(dto, client).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe(
      'Reviews open when the contract is completed, or ended with approved work.',
    );
  });

  it('an ENDED contract with no approved work cannot be reviewed (409)', async () => {
    const { service } = createService(
      contract(ContractStatus.ENDED, [
        MilestoneStatus.CANCELLED,
        MilestoneStatus.PENDING,
      ]),
    );
    await expect(service.create(dto, client)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('a second review is refused (409), also when the unique key fires', async () => {
    const first = createService(contract(ContractStatus.COMPLETED));
    first.tx.comment.findUnique.mockResolvedValue({ id: 5 });
    const error = await first.service.create(dto, client).catch((e) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.message).toBe('You already reviewed this contract.');

    const race = createService(contract(ContractStatus.COMPLETED));
    race.tx.comment.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: 'x',
      }),
    );
    await expect(race.service.create(dto, client)).rejects.toThrow(
      'You already reviewed this contract.',
    );
  });

  it('reviews an ENDED contract with one APPROVED milestone, taking the job from the contract', async () => {
    const { service, tx, events, redis } = createService(
      contract(ContractStatus.ENDED, [
        MilestoneStatus.APPROVED,
        MilestoneStatus.CANCELLED,
      ]),
    );
    const result = await service.create(dto, client);
    expect(tx.comment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          contractId: 20,
          jobId: 10,
          commenterId: client,
          content: 'Great work',
          rating: 5,
        },
      }),
    );
    expect(events.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        contractId: 20,
        actorId: client,
        type: 'review_left',
        data: { rating: 5 },
      }),
    );
    expect(events.announce).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'contract',
        recipientId: freelancer,
        actorId: client,
        step: 'review_left',
        recipientSide: 'freelancer',
      }),
    );
    expect(redis.invalidateCommentCaches).toHaveBeenCalledWith(10);
    expect(result.message).toBe('Comment created successfully');
  });

  it('a missing contract is 404', async () => {
    const { service } = createService(null);
    await expect(service.create(dto, client)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

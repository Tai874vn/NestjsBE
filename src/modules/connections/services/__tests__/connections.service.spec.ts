import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  ConnectionsService,
  pairKeyFor,
} from '../connections.service';
import { Prisma } from '@prisma/client';

describe('ConnectionsService', () => {
  const createService = () => {
    const prisma = {
      user: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      connection: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn(),
        updateMany: jest.fn(),
        delete: jest.fn(),
      },
    };
    return {
      prisma,
      service: new ConnectionsService(prisma as never),
    };
  };

  it('builds one canonical key for either request direction', () => {
    expect(pairKeyFor(9, 3)).toBe('3:9');
    expect(pairKeyFor(3, 9)).toBe('3:9');
  });

  it('rejects self requests and reversed duplicate requests', async () => {
    const { service, prisma } = createService();
    await expect(service.sendRequest(4, 4)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    prisma.user.findUnique.mockResolvedValue({ id: 8 });
    prisma.connection.findUnique.mockResolvedValue({
      id: 2,
      status: 'PENDING',
    });
    await expect(service.sendRequest(4, 8)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.connection.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { pairKey: '4:8' } }),
    );
  });

  it('allows only the recipient to accept a pending request', async () => {
    const { service, prisma } = createService();
    prisma.connection.findUnique
      .mockResolvedValueOnce({
        id: 12,
        requesterId: 4,
        recipientId: 8,
        status: 'PENDING',
      })
      .mockResolvedValueOnce({
        id: 12,
        requesterId: 4,
        recipientId: 8,
        status: 'PENDING',
      })
      .mockResolvedValueOnce({
        id: 12,
        requesterId: 4,
        recipientId: 8,
        status: 'ACCEPTED',
      });

    await expect(service.acceptRequest(12, 4)).rejects.toBeInstanceOf(
      ForbiddenException,
    );

    prisma.connection.updateMany.mockResolvedValue({ count: 1 });
    await service.acceptRequest(12, 8);
    expect(prisma.connection.updateMany).toHaveBeenCalledWith({
      where: { id: 12, recipientId: 8, status: 'PENDING' },
      data: { status: 'ACCEPTED' },
    });
  });

  it('returns conflict if a concurrent connection request already created the pair', async () => {
    const { service, prisma } = createService();
    prisma.user.findUnique.mockResolvedValue({ id: 8 });
    prisma.connection.findUnique.mockResolvedValue(null);
    prisma.connection.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(service.sendRequest(4, 8)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('does not accept twice when two accepts race', async () => {
    const { service, prisma } = createService();
    prisma.connection.findUnique.mockResolvedValue({
      id: 12,
      requesterId: 4,
      recipientId: 8,
      status: 'PENDING',
    });
    prisma.connection.updateMany.mockResolvedValue({ count: 0 });

    await expect(service.acceptRequest(12, 8)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('returns public suggestions without email or phone', async () => {
    const { service, prisma } = createService();
    prisma.connection.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({
      id: 4,
      location: 'Phnom Penh',
      profileSkills: [{ name: 'NestJS' }],
    });
    prisma.user.findMany.mockResolvedValue([
      {
        id: 8,
        name: 'Maya',
        avatar: null,
        headline: 'Backend developer',
        bio: 'Builds APIs',
        location: 'Phnom Penh',
        profileSkills: [{ name: 'NestJS' }],
        portfolioItems: [{ id: 1 }],
      },
    ]);
    prisma.user.count.mockResolvedValue(1);

    const result = await service.getSuggestions(4, {
      page: 1,
      pageSize: 12,
    });

    expect(result.content.data[0]).toMatchObject({
      id: 8,
      name: 'Maya',
      sharedSkills: ['NestJS'],
    });
    expect(result.content.data[0]).not.toHaveProperty('email');
    expect(result.content.data[0]).not.toHaveProperty('phone');
  });

  it('ranks people who share a skill or city before others, then cuts the page', async () => {
    const { service, prisma } = createService();
    prisma.connection.findMany.mockResolvedValue([]);
    prisma.user.findUnique.mockResolvedValue({
      id: 4,
      location: 'Hanoi',
      profileSkills: [{ name: 'React' }],
    });
    const person = (id: number, location: string, skills: string[]) => ({
      id, name: `P${id}`, avatar: null, headline: null, bio: null, location,
      profileSkills: skills.map((name) => ({ name })), portfolioItems: [],
    });
    // 1st call: related people (shared skill or city). 2nd call: everyone else, newest first.
    prisma.user.findMany
      .mockResolvedValueOnce([person(30, 'Hanoi', []), person(20, 'Hue', ['react'])])
      .mockResolvedValueOnce([person(99, 'Hue', [])]);
    prisma.user.count.mockResolvedValue(3);

    const result = await service.getSuggestions(4, { page: 1, pageSize: 2 });

    expect(result.content.data.map((user) => user.id)).toEqual([20, 30]);
    expect(prisma.user.findMany.mock.calls[0][0].where.AND[1].OR).toHaveLength(2);
  });

  it('paginates accepted connections in the database', async () => {
    const { service, prisma } = createService();
    prisma.connection.findMany.mockResolvedValue([]);

    await service.getConnections(4, { page: 2, pageSize: 5 });

    expect(prisma.connection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
    );
    expect(prisma.connection.count).toHaveBeenCalledTimes(1);
  });
});

import { ForbiddenException } from '@nestjs/common';
import { Role } from '../../../common/constants/roles';
import { HiresService } from './hires.service';

describe('HiresService object authorization', () => {
  const createService = () => {
    const prisma = { hire: { findUnique: jest.fn() } };
    return { service: new HiresService(prisma as never, {} as never), prisma };
  };

  it('denies hire details to users who are neither buyer nor service owner', async () => {
    const { service, prisma } = createService();
    prisma.hire.findUnique.mockResolvedValue({
      id: 9,
      hirerId: 2,
      job: { creatorId: 3 },
      user: { id: 2, name: 'Buyer', email: 'buyer@example.com', avatar: null },
    });

    await expect(service.findOne(9, 4, Role.USER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ['buyer', 2, Role.USER],
    ['service owner', 3, Role.USER],
    ['admin', 4, Role.ADMIN],
  ] as const)('allows the %s to read a hire', async (_label, userId, role) => {
    const { service, prisma } = createService();
    prisma.hire.findUnique.mockResolvedValue({
      id: 9,
      hirerId: 2,
      job: { creatorId: 3 },
      user: { id: 2, name: 'Buyer', email: 'buyer@example.com', avatar: null },
    });

    await expect(service.findOne(9, userId, role)).resolves.toMatchObject({ content: { id: 9 } });
  });
});

describe('HiresService completion notifications', () => {
  const createService = () => {
    const prisma = {
      hire: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };
    const redis = { invalidateUserCaches: jest.fn() };
    const notifications = { notifyHireCompleted: jest.fn() };
    const service = new HiresService(
      prisma as never,
      redis as never,
      notifications as never,
    );
    return { service, prisma, notifications };
  };

  it('notifies only when a hire transitions from incomplete to complete', async () => {
    const { service, prisma, notifications } = createService();
    prisma.hire.findUnique.mockResolvedValue({
      id: 9,
      hirerId: 2,
      completed: false,
      job: { creatorId: 3 },
    });
    prisma.hire.update.mockResolvedValue({
      id: 9,
      completed: true,
      job: { id: 7, title: 'API work' },
      user: { id: 2 },
    });

    await service.update(9, { completed: true }, 2, Role.USER);

    expect(notifications.notifyHireCompleted).toHaveBeenCalledTimes(1);
  });

  it('does not notify again when an already completed hire is updated', async () => {
    const { service, prisma, notifications } = createService();
    prisma.hire.findUnique.mockResolvedValue({
      id: 9,
      hirerId: 2,
      completed: true,
      job: { creatorId: 3 },
    });
    prisma.hire.update.mockResolvedValue({
      id: 9,
      completed: true,
      job: { id: 7, title: 'API work' },
      user: { id: 2 },
    });

    await service.update(9, { completed: true }, 2, Role.USER);

    expect(notifications.notifyHireCompleted).not.toHaveBeenCalled();
  });
});

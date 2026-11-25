import { EmailVerificationService } from './email-verification.service';
import { PasswordResetService } from './password-reset.service';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function prismaMock() {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((fn: (tx: unknown) => unknown) =>
    fn(prisma),
  );
  return prisma;
}

describe('EmailVerificationService.verify', () => {
  const setup = () => {
    const prisma = prismaMock();
    const tokens = { consume: jest.fn() };
    const mails = { sendVerification: jest.fn(), canSendAgain: jest.fn() };
    const service = new EmailVerificationService(
      prisma as any,
      tokens as any,
      mails as any,
    );
    return { prisma, tokens, mails, service };
  };

  it('rejects a bad, used or expired link with EMAIL_LINK_INVALID', async () => {
    const { tokens, service } = setup();
    tokens.consume.mockResolvedValue(null);
    await expect(service.verify('x')).rejects.toMatchObject({
      status: 400,
      response: expect.objectContaining({ code: 'EMAIL_LINK_INVALID' }),
    });
  });

  it('marks the current address as verified', async () => {
    const { prisma, tokens, service } = setup();
    tokens.consume.mockResolvedValue({ userId: 4, email: 'a@b.c' });
    prisma.user.findUnique.mockResolvedValue({
      id: 4,
      email: 'a@b.c',
      pendingEmail: null,
      emailVerifiedAt: null,
      bannedAt: null,
    });
    await expect(service.verify('t')).resolves.toEqual({ email: 'a@b.c' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { emailVerifiedAt: expect.any(Date) },
    });
  });

  it('switches to the pending new address only when its own link is opened', async () => {
    const { prisma, tokens, service } = setup();
    tokens.consume.mockResolvedValue({ userId: 4, email: 'new@b.c' });
    prisma.user.findUnique.mockResolvedValue({
      id: 4,
      email: 'old@b.c',
      pendingEmail: 'new@b.c',
      emailVerifiedAt: new Date(),
      bannedAt: null,
    });
    prisma.user.findFirst.mockResolvedValue(null);
    await expect(service.verify('t')).resolves.toEqual({ email: 'new@b.c' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: {
        email: 'new@b.c',
        pendingEmail: null,
        emailVerifiedAt: expect.any(Date),
      },
    });
  });

  it('refuses the switch when another account took the address meanwhile', async () => {
    const { prisma, tokens, service } = setup();
    tokens.consume.mockResolvedValue({ userId: 4, email: 'new@b.c' });
    prisma.user.findUnique.mockResolvedValue({
      id: 4,
      email: 'old@b.c',
      pendingEmail: 'new@b.c',
      bannedAt: null,
    });
    prisma.user.findFirst.mockResolvedValue({ id: 9 });
    await expect(service.verify('t')).rejects.toMatchObject({ status: 409 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('a link for an address the user no longer has does nothing', async () => {
    const { prisma, tokens, service } = setup();
    tokens.consume.mockResolvedValue({ userId: 4, email: 'older@b.c' });
    prisma.user.findUnique.mockResolvedValue({
      id: 4,
      email: 'now@b.c',
      pendingEmail: null,
      bannedAt: null,
    });
    await expect(service.verify('t')).rejects.toMatchObject({ status: 400 });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe('EmailVerificationService.resendForEmail', () => {
  const setup = () => {
    const prisma = prismaMock();
    const mails = {
      sendVerification: jest.fn().mockResolvedValue(true),
      canSendAgain: jest.fn().mockResolvedValue(true),
    };
    const service = new EmailVerificationService(
      prisma as any,
      {} as any,
      mails as any,
    );
    return { prisma, mails, service };
  };

  it('mails an unverified account again', async () => {
    const { prisma, mails, service } = setup();
    prisma.user.findFirst.mockResolvedValue({
      id: 1,
      name: 'A',
      email: 'a@b.c',
      emailVerifiedAt: null,
      pendingEmail: null,
    });
    service.resendForEmail('a@b.c');
    await flush();
    expect(mails.sendVerification).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'a@b.c',
    );
  });

  it('does nothing for an unknown, verified or banned account, or inside the cooldown', async () => {
    const { prisma, mails, service } = setup();
    prisma.user.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 2, email: 'v@b.c', emailVerifiedAt: new Date() })
      .mockResolvedValueOnce({ id: 3, email: 'x@b.c', emailVerifiedAt: null, bannedAt: new Date() })
      .mockResolvedValueOnce({ id: 4, email: 'y@b.c', emailVerifiedAt: null });
    mails.canSendAgain.mockResolvedValue(false);
    for (const email of ['n@b.c', 'v@b.c', 'x@b.c', 'y@b.c']) {
      service.resendForEmail(email);
      await flush();
    }
    expect(mails.sendVerification).not.toHaveBeenCalled();
  });
});

describe('PasswordResetService', () => {
  const setup = () => {
    const prisma = prismaMock();
    const tokens = { consume: jest.fn() };
    const mails = {
      sendPasswordReset: jest.fn().mockResolvedValue(true),
      canSendAgain: jest.fn().mockResolvedValue(true),
    };
    const sessions = { resetPassword: jest.fn().mockResolvedValue(undefined) };
    const service = new PasswordResetService(
      prisma as any,
      tokens as any,
      mails as any,
      sessions as any,
    );
    return { prisma, tokens, mails, sessions, service };
  };

  it('request() mails a known account and is silent for an unknown one', async () => {
    const { prisma, mails, service } = setup();
    prisma.user.findFirst
      .mockResolvedValueOnce({ id: 1, name: 'A', email: 'a@b.c', bannedAt: null })
      .mockResolvedValueOnce(null);
    service.request('a@b.c');
    await flush();
    service.request('nobody@b.c');
    await flush();
    expect(mails.sendPasswordReset).toHaveBeenCalledTimes(1);
    expect(mails.sendPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1 }),
      'a@b.c',
    );
  });

  it('reset() sets the password through the session service (signs out every device)', async () => {
    const { prisma, tokens, sessions, service } = setup();
    tokens.consume.mockResolvedValue({ userId: 1, email: 'a@b.c' });
    prisma.user.findUnique.mockResolvedValue({ id: 1, email: 'A@b.c', bannedAt: null });
    await service.reset('t', 'new-password-123');
    expect(sessions.resetPassword).toHaveBeenCalledWith(1, 'new-password-123', 'a@b.c');
  });

  it('reset() refuses a bad link, a banned user, or a link sent to an old address', async () => {
    const { prisma, tokens, sessions, service } = setup();
    tokens.consume.mockResolvedValueOnce(null);
    await expect(service.reset('t', 'new-password-123')).rejects.toMatchObject({ status: 400 });

    tokens.consume.mockResolvedValueOnce({ userId: 1, email: 'a@b.c' });
    prisma.user.findUnique.mockResolvedValueOnce({ id: 1, email: 'a@b.c', bannedAt: new Date() });
    await expect(service.reset('t', 'new-password-123')).rejects.toMatchObject({ status: 400 });

    tokens.consume.mockResolvedValueOnce({ userId: 1, email: 'old@b.c' });
    prisma.user.findUnique.mockResolvedValueOnce({ id: 1, email: 'new@b.c', bannedAt: null });
    await expect(service.reset('t', 'new-password-123')).rejects.toMatchObject({ status: 400 });

    expect(sessions.resetPassword).not.toHaveBeenCalled();
  });
});

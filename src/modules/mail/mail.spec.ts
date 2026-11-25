import { EmailTokenPurpose } from '@prisma/client';
import { AccountEmailsService } from './account-emails.service';
import { EmailTokensService, hashEmailToken } from './email-tokens.service';
import { MailService } from './mail.service';
import { resetPasswordMail, verifyEmailMail } from './mail-templates';

const config = (values: Record<string, string | undefined>) =>
  ({
    get: (key: string) => values[key],
    getOrThrow: (key: string) => {
      if (!values[key]) throw new Error(`missing ${key}`);
      return values[key];
    },
  }) as any;

describe('MailService', () => {
  const message = {
    to: 'user@example.com',
    subject: 'Hi',
    html: '<p>Hi</p>',
    text: 'Hi',
    kind: 'verify-email',
  };
  afterEach(() => jest.restoreAllMocks());

  it('sends nothing and answers false without RESEND_API_KEY', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const mail = new MailService(config({}));
    await expect(mail.send(message)).resolves.toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts to Resend with the key, sender, both parts and the kind tag', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{"id":"x"}', { status: 200 }));
    const mail = new MailService(
      config({ RESEND_API_KEY: 're_test', MAIL_FROM: 'JobAura <a@b.c>' }),
    );
    await expect(mail.send(message)).resolves.toBe(true);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      'Bearer re_test',
    );
    expect(JSON.parse(init!.body as string)).toEqual({
      from: 'JobAura <a@b.c>',
      to: ['user@example.com'],
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      tags: [{ name: 'kind', value: 'verify-email' }],
    });
  });

  it('never throws: an error answer or a network failure gives false', async () => {
    const mail = new MailService(config({ RESEND_API_KEY: 're_test' }));
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('domain not verified', { status: 403 }))
      .mockRejectedValueOnce(new Error('network down'));
    await expect(mail.send(message)).resolves.toBe(false);
    await expect(mail.send(message)).resolves.toBe(false);
  });
});

describe('mail templates', () => {
  it('escape the user name in HTML and keep a plain-text part with the link', () => {
    const mail = verifyEmailMail(
      '<script>x</script>',
      'https://www.jobaura.site/auth/verify-email#token=abc',
      1440,
    );
    expect(mail.html).not.toContain('<script>x</script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.text).toContain(
      'https://www.jobaura.site/auth/verify-email#token=abc',
    );
    expect(mail.text).toContain('24 hours');
  });

  it('reset mail says how long the link lasts', () => {
    const mail = resetPasswordMail('A', 'https://x/reset#token=t', 30);
    expect(mail.subject).toBe('Reset your JobAura password');
    expect(mail.text).toContain('30 minutes');
  });
});

describe('EmailTokensService', () => {
  const prismaMock = () => {
    const tx = {
      emailToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn(),
      },
    };
    return {
      tx,
      prisma: {
        ...tx,
        $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
        emailToken: { ...tx.emailToken, findFirst: jest.fn() },
      },
    };
  };

  it('issue() cancels older unused links of the same kind and saves only the hash', async () => {
    const { prisma, tx } = prismaMock();
    const tokens = new EmailTokensService(prisma as any);
    const now = new Date('2026-11-26T00:00:00Z');
    const token = await tokens.issue({
      userId: 5,
      purpose: EmailTokenPurpose.RESET_PASSWORD,
      email: 'a@b.c',
      ttlMs: 60_000,
      now,
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tx.emailToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 5, purpose: 'RESET_PASSWORD', usedAt: null },
      data: { usedAt: now },
    });
    const saved = tx.emailToken.create.mock.calls[0][0].data;
    expect(saved.tokenHash).toBe(hashEmailToken(token));
    expect(saved.tokenHash).not.toContain(token);
    expect(saved.expiresAt).toEqual(new Date(now.getTime() + 60_000));
  });

  it('consume() uses the token in one guarded update: unused, same kind, not expired', async () => {
    const { prisma } = prismaMock();
    const tokens = new EmailTokensService(prisma as any);
    const now = new Date('2026-11-26T00:00:00Z');
    prisma.emailToken.updateMany.mockResolvedValueOnce({ count: 1 });
    prisma.emailToken.findUnique.mockResolvedValueOnce({ id: 1, userId: 5 });

    await expect(
      tokens.consume('tok', EmailTokenPurpose.VERIFY_EMAIL, prisma as any, now),
    ).resolves.toEqual({ id: 1, userId: 5 });
    expect(prisma.emailToken.updateMany).toHaveBeenCalledWith({
      where: {
        tokenHash: hashEmailToken('tok'),
        purpose: 'VERIFY_EMAIL',
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
    });
  });

  it('consume() answers null when the guarded update matches nothing (used, expired, wrong kind)', async () => {
    const { prisma } = prismaMock();
    const tokens = new EmailTokensService(prisma as any);
    prisma.emailToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      tokens.consume('tok', EmailTokenPurpose.VERIFY_EMAIL, prisma as any),
    ).resolves.toBeNull();
    await expect(
      tokens.consume('', EmailTokenPurpose.VERIFY_EMAIL, prisma as any),
    ).resolves.toBeNull();
    expect(prisma.emailToken.findUnique).not.toHaveBeenCalled();
  });
});

describe('AccountEmailsService', () => {
  it('puts the token after # in the link and sends the mail to the given address', async () => {
    const tokens = { issue: jest.fn().mockResolvedValue('T0KEN'), lastIssuedAt: jest.fn() };
    const mail = { send: jest.fn().mockResolvedValue(true) };
    const service = new AccountEmailsService(
      tokens as any,
      mail as any,
      config({ FRONTEND_URL: 'https://www.jobaura.site/' }),
    );
    await service.sendPasswordReset({ id: 3, name: 'A' }, 'a@b.c');
    expect(tokens.issue).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 3, purpose: 'RESET_PASSWORD', ttlMs: 30 * 60_000 }),
    );
    const sent = mail.send.mock.calls[0][0];
    expect(sent.to).toBe('a@b.c');
    expect(sent.kind).toBe('reset-password');
    expect(sent.text).toContain('https://www.jobaura.site/auth/reset-password#token=T0KEN');
  });

  it('canSendAgain() waits one minute between mails of the same kind', async () => {
    const now = new Date('2026-11-26T00:01:00Z');
    const tokens = { lastIssuedAt: jest.fn() };
    const service = new AccountEmailsService(tokens as any, {} as any, config({}));
    tokens.lastIssuedAt.mockResolvedValueOnce(new Date('2026-11-26T00:00:30Z'));
    await expect(service.canSendAgain(1, EmailTokenPurpose.VERIFY_EMAIL, now)).resolves.toBe(false);
    tokens.lastIssuedAt.mockResolvedValueOnce(new Date('2026-11-26T00:00:00Z'));
    await expect(service.canSendAgain(1, EmailTokenPurpose.VERIFY_EMAIL, now)).resolves.toBe(true);
    tokens.lastIssuedAt.mockResolvedValueOnce(null);
    await expect(service.canSendAgain(1, EmailTokenPurpose.VERIFY_EMAIL, now)).resolves.toBe(true);
  });
});

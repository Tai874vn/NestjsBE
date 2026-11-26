import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import {
  AcceptProposalDto,
  CreateProposalDto,
  DeclineProposalDto,
  ProposalListQueryDto,
  VersionBodyDto,
} from '../proposal.dto';
import { CreateAmendmentDto } from '../amendment.dto';

/** Every message, also the ones of nested rows (milestones). */
function messagesOf(errors: ValidationError[]): string[] {
  return errors.flatMap((error) => [
    ...Object.values(error.constraints ?? {}),
    ...messagesOf(error.children ?? []),
  ]);
}

async function parse<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) {
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return { dto, messages: messagesOf(errors) };
}

const image =
  '/uploads/images/contracts/550e8400-e29b-41d4-a716-446655440000.webp';

function milestone(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Logo sketches',
    description: 'Three ideas',
    dueDate: '2026-12-01T16:59:00.000Z',
    amount: 300,
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}) {
  return {
    brief: 'A logo for my bakery',
    referenceLinks: ['https://example.com/style'],
    referenceImages: [image],
    deadline: '2026-12-10T16:59:00.000Z',
    milestones: [milestone()],
    ...overrides,
  };
}

describe('proposal DTOs', () => {
  it('accepts a full body and trims the brief', async () => {
    const { dto, messages } = await parse(
      CreateProposalDto,
      body({ jobId: 4, brief: '  A logo  ' }),
    );
    expect(messages).toEqual([]);
    expect(dto.brief).toBe('A logo');
  });

  it('allows no links and no images', async () => {
    // A JSON body leaves the keys out (it has no `undefined`).
    const { referenceLinks, referenceImages, ...rest } = body();
    expect([referenceLinks, referenceImages]).toHaveLength(2);
    const { dto, messages } = await parse(VersionBodyDto, rest);
    expect(messages).toEqual([]);
    expect(dto.referenceLinks).toEqual([]);
    expect(dto.referenceImages).toEqual([]);
  });

  it('turns null lists into empty lists', async () => {
    const { dto, messages } = await parse(
      VersionBodyDto,
      body({ referenceLinks: null, referenceImages: null }),
    );
    expect(messages).toEqual([]);
    expect(dto.referenceLinks).toEqual([]);
    expect(dto.referenceImages).toEqual([]);
  });

  // Review Focus 5: images only from our local JobAura upload path.
  it.each([
    'https://res.cloudinary.com/other-cloud/image/upload/a.png',
    'https://res.cloudinary.com/jobaura-test/image/upload/a.png',
    'https://evil.com/uploads/images/contracts/550e8400-e29b-41d4-a716-446655440000.webp',
    '/uploads/images/contracts/550e8400-e29b-41d4-a716-446655440000.png',
    '/uploads/images/contracts/../avatars/550e8400-e29b-41d4-a716-446655440000.webp',
    '/uploads/private/documents/resumes/550e8400-e29b-41d4-a716-446655440000.pdf',
    'not a url',
  ])('refuses the image %s', async (url) => {
    const { messages } = await parse(
      VersionBodyDto,
      body({ referenceImages: [image, url] }),
    );
    expect(messages).toEqual([
      'referenceImages must be uploaded through JobAura.',
    ]);
  });

  // Review Focus 5: links only http or https.
  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,hi',
    'ftp://example.com/file',
    'example.com',
  ])('refuses the link %s', async (url) => {
    const { messages } = await parse(
      VersionBodyDto,
      body({ referenceLinks: [url] }),
    );
    expect(messages).toEqual(['referenceLinks must be web links.']);
  });

  it('accepts http and https links', async () => {
    const { messages } = await parse(
      VersionBodyDto,
      body({ referenceLinks: ['http://a.vn/x', 'https://b.com/y?z=1'] }),
    );
    expect(messages).toEqual([]);
  });

  it('refuses more than 10 links or images', async () => {
    const links = Array.from({ length: 11 }, (_, i) => `https://a.vn/${i}`);
    expect(
      (await parse(VersionBodyDto, body({ referenceLinks: links }))).messages,
    ).toHaveLength(1);
    const images = Array.from({ length: 11 }, () => image);
    expect(
      (await parse(VersionBodyDto, body({ referenceImages: images })))
        .messages,
    ).toHaveLength(1);
  });

  it('refuses 21 milestones and no milestones', async () => {
    const many = Array.from({ length: 21 }, () => milestone());
    expect(
      (await parse(VersionBodyDto, body({ milestones: many }))).messages,
    ).toHaveLength(1);
    expect(
      (await parse(VersionBodyDto, body({ milestones: [] }))).messages,
    ).toHaveLength(1);
    const twenty = Array.from({ length: 20 }, () => milestone());
    expect(
      (await parse(VersionBodyDto, body({ milestones: twenty }))).messages,
    ).toEqual([]);
  });

  it('caps a milestone amount at 1,000,000 credits (400 naming the field, not a 500)', async () => {
    const over = await parse(
      VersionBodyDto,
      body({ milestones: [milestone({ amount: 2_000_000_000 })] }),
    );
    expect(over.messages).toEqual(['amount must not be greater than 1000000']);
    const max = await parse(
      VersionBodyDto,
      body({ milestones: [milestone({ amount: 1_000_000 })] }),
    );
    expect(max.messages).toEqual([]);
  });

  it('caps an amendment amount at 1,000,000 credits', async () => {
    const dto = plainToInstance(CreateAmendmentDto, {
      changes: [{ op: 'amount', milestoneId: 31, amount: 1_000_001 }],
    });
    const messages = messagesOf(await validate(dto, { whitelist: true }));
    expect(messages).toContain('amount must not be greater than 1000000');
  });

  it.each([0, -5, 1.5, '300'])(
    'refuses the milestone amount %p',
    async (amount) => {
      const { messages } = await parse(
        VersionBodyDto,
        body({ milestones: [milestone({ amount })] }),
      );
      expect(messages.length).toBeGreaterThan(0);
    },
  );

  it('refuses an empty or long milestone title and a bad due date', async () => {
    for (const bad of [
      { title: '   ' },
      { title: 'x'.repeat(121) },
      { description: 'x'.repeat(2001) },
      { dueDate: 'next week' },
    ]) {
      const { messages } = await parse(
        VersionBodyDto,
        body({ milestones: [milestone(bad)] }),
      );
      expect(messages.length).toBeGreaterThan(0);
    }
  });

  it('refuses an empty or too long brief', async () => {
    expect(
      (await parse(VersionBodyDto, body({ brief: '  ' }))).messages.length,
    ).toBeGreaterThan(0);
    expect(
      (await parse(VersionBodyDto, body({ brief: 'x'.repeat(5001) })))
        .messages.length,
    ).toBeGreaterThan(0);
  });

  it('accept needs the version number the user read', async () => {
    expect((await parse(AcceptProposalDto, {})).messages.length).toBeGreaterThan(0);
    expect((await parse(AcceptProposalDto, { version: 0 })).messages).toHaveLength(1);
    expect((await parse(AcceptProposalDto, { version: 2 })).messages).toEqual([]);
  });

  it('decline takes an optional note up to 1000 characters', async () => {
    expect((await parse(DeclineProposalDto, {})).messages).toEqual([]);
    expect(
      (await parse(DeclineProposalDto, { note: 'x'.repeat(1001) })).messages,
    ).toHaveLength(1);
  });

  it('the list query defaults to the client tab, page 1 of 20', async () => {
    const { dto, messages } = await parse(ProposalListQueryDto, {});
    expect(messages).toEqual([]);
    expect(dto).toMatchObject({ role: 'client', page: 1, pageSize: 20 });
    expect(
      (await parse(ProposalListQueryDto, { role: 'boss' })).messages,
    ).toHaveLength(1);
    expect(
      (await parse(ProposalListQueryDto, { status: 'OPEN', page: '2' })).dto,
    ).toMatchObject({ status: 'OPEN', page: 2 });
  });
});

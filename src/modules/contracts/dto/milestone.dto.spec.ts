import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RequestChangesDto, SubmitWorkDto } from './milestone.dto';

async function messages<T extends object>(
  cls: new () => T,
  body: Record<string, unknown>,
) {
  const errors = await validate(plainToInstance(cls, body), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

const CLOUD = 'jobaura-test';
const image = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/contracts/a.png`;

describe('milestone DTOs', () => {
  const old = process.env.CLOUDINARY_CLOUD_NAME;
  beforeAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = CLOUD;
  });
  afterAll(() => {
    process.env.CLOUDINARY_CLOUD_NAME = old;
  });

  it('SubmitWorkDto accepts a note with our images and web links; null lists become empty', async () => {
    expect(
      await messages(SubmitWorkDto, {
        note: 'Done',
        images: [image],
        links: ['https://figma.com/x'],
      }),
    ).toEqual([]);
    const dto = plainToInstance(SubmitWorkDto, {
      note: 'Done',
      images: null,
      links: null,
    });
    expect(dto).toMatchObject({ images: [], links: [] });
  });

  it('SubmitWorkDto names the field: empty note, foreign image, javascript: link, 11 links', async () => {
    expect(
      await messages(SubmitWorkDto, { note: '  ', images: [], links: [] }),
    ).toEqual([expect.stringMatching(/^note/)]);
    expect(
      await messages(SubmitWorkDto, {
        note: 'x',
        images: ['https://res.cloudinary.com/other/image/upload/a.png'],
      }),
    ).toEqual(['images must be uploaded through JobAura.']);
    expect(
      await messages(SubmitWorkDto, {
        note: 'x',
        links: ['javascript:alert(1)'],
      }),
    ).toEqual(['links must be web links.']);
    expect(
      await messages(SubmitWorkDto, {
        note: 'x',
        links: Array.from({ length: 11 }, (_, i) => `https://a.com/${i}`),
      }),
    ).toEqual([expect.stringMatching(/^links/)]);
  });

  it('RequestChangesDto needs a note of 1 to 2000 characters', async () => {
    expect(await messages(RequestChangesDto, { note: 'Bigger' })).toEqual([]);
    expect(await messages(RequestChangesDto, { note: '' })).toEqual([
      expect.stringMatching(/^note/),
    ]);
    expect(
      await messages(RequestChangesDto, { note: 'x'.repeat(2001) }),
    ).toEqual([expect.stringMatching(/^note/)]);
  });
});

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AcceptInterviewDto,
  InterviewTimesDto,
  RequestInterviewDto,
} from './interview.dto';

async function messages<T extends object>(
  type: new () => T,
  body: Record<string, unknown>,
) {
  const dto = plainToInstance(type, body);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return {
    dto,
    fields: errors.map((error) => error.property),
  };
}

const T1 = '2030-01-01T03:00:00Z';
const T2 = '2030-01-02T03:00:00Z';

describe('RequestInterviewDto', () => {
  it('accepts a simple online request and trims the texts', async () => {
    const { dto, fields } = await messages(RequestInterviewDto, {
      mode: 'ONLINE',
      proposedTimes: [T1, T2],
      note: '  Bring your laptop  ',
    });
    expect(fields).toEqual([]);
    expect(dto.note).toBe('Bring your laptop');
  });

  it.each([
    ['no times', []],
    ['4 times', [T1, T2, '2030-01-03T03:00:00Z', '2030-01-04T03:00:00Z']],
    ['a time that is not ISO', ['next tuesday']],
    ['not a list', T1],
  ])('refuses %s', async (_name, proposedTimes) => {
    const { fields } = await messages(RequestInterviewDto, {
      mode: 'ONLINE',
      proposedTimes,
    });
    expect(fields).toEqual(['proposedTimes']);
  });

  it('refuses an unknown mode', async () => {
    const { fields } = await messages(RequestInterviewDto, {
      mode: 'VIDEO',
      proposedTimes: [T1],
    });
    expect(fields).toEqual(['mode']);
  });

  it('duration is a whole number from 15 to 120', async () => {
    const check = (durationMinutes: unknown) =>
      messages(RequestInterviewDto, {
        mode: 'ONLINE',
        proposedTimes: [T1],
        durationMinutes,
      }).then((result) => result.fields);
    expect(await check(15)).toEqual([]);
    expect(await check(120)).toEqual([]);
    expect(await check(14)).toEqual(['durationMinutes']);
    expect(await check(121)).toEqual(['durationMinutes']);
    expect(await check(30.5)).toEqual(['durationMinutes']);
  });

  it('onsite needs a location of up to 300 characters', async () => {
    const check = (location?: string) =>
      messages(RequestInterviewDto, {
        mode: 'ONSITE',
        proposedTimes: [T1],
        ...(location !== undefined ? { location } : {}),
      }).then((result) => result.fields);
    expect(await check()).toEqual(['location']);
    expect(await check('   ')).toEqual(['location']);
    expect(await check('x'.repeat(301))).toEqual(['location']);
    expect(await check('12 Le Loi, District 1')).toEqual([]);
  });

  it('a note is up to 1000 characters', async () => {
    const { fields } = await messages(RequestInterviewDto, {
      mode: 'PHONE',
      proposedTimes: [T1],
      note: 'x'.repeat(1001),
    });
    expect(fields).toEqual(['note']);
  });
});

describe('InterviewTimesDto', () => {
  it('needs 1 to 3 ISO times', async () => {
    expect(
      (await messages(InterviewTimesDto, { proposedTimes: [T1] })).fields,
    ).toEqual([]);
    expect(
      (await messages(InterviewTimesDto, { proposedTimes: [] })).fields,
    ).toEqual(['proposedTimes']);
  });
});

describe('AcceptInterviewDto', () => {
  it('needs startsAt as an ISO time', async () => {
    expect(
      (await messages(AcceptInterviewDto, { startsAt: T1 })).fields,
    ).toEqual([]);
    expect(
      (await messages(AcceptInterviewDto, { startsAt: 'soon' })).fields,
    ).toEqual(['startsAt']);
    expect((await messages(AcceptInterviewDto, {})).fields).toEqual([
      'startsAt',
    ]);
  });
});

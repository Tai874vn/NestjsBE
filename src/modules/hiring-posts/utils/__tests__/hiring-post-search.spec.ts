import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HiringPostQueryDto } from '../../dto/hiring-post-query.dto';
import {
  containsPattern,
  keywordTextFields,
  keywordWhere,
} from '../hiring-post-search';

describe('hiring post keyword search', () => {
  it('searches these text fields (contains, ignoring case)', () => {
    const fields = keywordTextFields('react').map((condition) =>
      Object.keys(condition)[0] === 'recruiter'
        ? 'recruiter.name'
        : Object.keys(condition)[0],
    );
    expect(fields).toEqual([
      'title',
      'description',
      'requirements',
      'location',
      'employmentType',
      'companyName',
      'recruiter.name',
    ]);
    expect(keywordTextFields('react')[0]).toEqual({
      title: { contains: 'react', mode: 'insensitive' },
    });
  });

  it('treats % and _ in the keyword as plain characters in the skills LIKE pattern', () => {
    // In LIKE, % means "anything" and _ means "one character"; escaped, they only match themselves.
    expect(containsPattern('50%_off')).toBe(String.raw`%50\%\_off%`);
    expect(containsPattern(String.raw`a\b`)).toBe(String.raw`%a\\b%`);
  });

  it('adds the posts whose skills match, sending the pattern as a SQL parameter', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ id: 7 }]) };
    const where = await keywordWhere(prisma as never, 'sel%');
    const [strings, pattern] = prisma.$queryRaw.mock.calls[0] as [
      TemplateStringsArray,
      string,
    ];
    expect(strings.join('?')).toContain('skill ILIKE ?');
    expect(pattern).toBe(String.raw`%sel\%%`);
    expect(where.OR).toContainEqual({ id: { in: [7] } });
  });

  it('searches only the fields the frontend asks for (searchIn); no skills query without "skills"', async () => {
    const prisma = { $queryRaw: jest.fn() };
    const where = await keywordWhere(prisma as never, 'react', [
      'title',
      'companyName',
    ]);
    expect(where.OR).toEqual([
      { title: { contains: 'react', mode: 'insensitive' } },
      { companyName: { contains: 'react', mode: 'insensitive' } },
    ]);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('searchIn input check', () => {
  const check = (searchIn: unknown) =>
    validate(plainToInstance(HiringPostQueryDto, { searchIn }));

  it('accepts listed fields, as a comma list or repeated values', async () => {
    expect(await check('title,companyName')).toEqual([]);
    expect(await check(['title', 'skills'])).toEqual([]);
  });

  it('refuses a field that is not on the list (400)', async () => {
    const errors = await check('title,password');
    expect(errors[0].property).toBe('searchIn');
  });
});

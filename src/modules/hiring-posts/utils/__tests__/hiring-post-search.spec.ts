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
});

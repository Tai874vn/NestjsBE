import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { HiringPostQueryDto } from '../hiring-post-query.dto';

async function parse(query: Record<string, unknown>) {
  const dto = plainToInstance(HiringPostQueryDto, query);
  const errors = await validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return {
    dto,
    messages: errors.flatMap((error) => Object.values(error.constraints ?? {})),
  };
}

describe('HiringPostQueryDto', () => {
  it('splits comma-separated and repeated values, trimming and dropping repeats', async () => {
    const { dto, messages } = await parse({
      level: 'junior, Mid,,mid',
      employmentType: ['Full-time,Internship', 'full-time'],
      occupation: '2512.3',
    });
    expect(messages).toEqual([]);
    expect(dto.level).toEqual(['Junior', 'Mid']);
    expect(dto.employmentType).toEqual(['Full-time', 'Internship']);
    expect(dto.occupation).toEqual(['2512.3']);
  });

  it('names the invalid level', async () => {
    const { messages } = await parse({ level: 'Junior,Lead' });
    expect(messages).toEqual([
      'level must be one of Junior, Mid, Senior; invalid: Lead',
    ]);
  });

  it('accepts at most 10 values in a filter', async () => {
    const values = Array.from({ length: 11 }, (_, i) => `Type ${i}`).join(',');
    const { messages } = await parse({ employmentType: values });
    expect(messages).toEqual(['employmentType accepts at most 10 values']);
  });

  it('stops at page 100', async () => {
    expect((await parse({ page: '100' })).messages).toEqual([]);
    expect((await parse({ page: '100' })).dto.page).toBe(100);
    expect((await parse({ page: '101' })).messages).toEqual([
      'page must not be greater than 100; narrow the search to see more posts',
    ]);
    expect((await parse({ page: '0' })).messages).toEqual([
      'page must not be less than 1',
    ]);
    expect((await parse({})).dto.page).toBe(1);
  });

  it('rejects an unknown sort with the allowed values', async () => {
    expect((await parse({ sort: 'cheapest' })).messages).toEqual([
      'sort must be one of newest, oldest, closing_soon, salary_high',
    ]);
    expect((await parse({ sort: 'salary_high' })).messages).toEqual([]);
  });
});

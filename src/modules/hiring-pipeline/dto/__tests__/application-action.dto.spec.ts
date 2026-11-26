import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ApplicationActionDto } from '../application-action.dto';

async function parse(body: Record<string, unknown>) {
  const dto = plainToInstance(ApplicationActionDto, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  return { dto, messages: errors.flatMap((error) => Object.values(error.constraints ?? {})) };
}

describe('ApplicationActionDto', () => {
  it('trims the note and allows no note', async () => {
    expect((await parse({ note: '  Start on Monday  ' })).dto.note).toBe('Start on Monday');
    expect((await parse({})).messages).toEqual([]);
  });

  it('refuses a note longer than 1000 characters', async () => {
    expect((await parse({ note: 'x'.repeat(1000) })).messages).toEqual([]);
    expect((await parse({ note: 'x'.repeat(1001) })).messages).toHaveLength(1);
  });
});

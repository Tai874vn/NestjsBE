import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PostApplicationsQueryDto } from './post-applications-query.dto';

async function messages(query: Record<string, unknown>) {
  const errors = await validate(plainToInstance(PostApplicationsQueryDto, query), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.flatMap((error) => Object.values(error.constraints ?? {}));
}

describe('PostApplicationsQueryDto', () => {
  it('takes one of the 8 application statuses', async () => {
    expect(await messages({ status: 'OFFERED', page: '2' })).toEqual([]);
    expect(await messages({})).toEqual([]);
  });

  it('refuses a status that does not exist', async () => {
    expect(await messages({ status: 'ACCEPTED' })).toHaveLength(1);
  });
});

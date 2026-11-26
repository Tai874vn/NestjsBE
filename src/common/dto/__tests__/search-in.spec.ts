import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { JobSearchQueryDto } from '../../../modules/jobs/dto/job-search-query.dto';
import { CandidateDirectoryQueryDto } from '../../../modules/users/dto/candidate-directory-query.dto';

/** searchIn: the frontend chooses the keyword fields; only listed names pass. */
describe('searchIn (jobs and candidates)', () => {
  const jobs = (searchIn: unknown) =>
    plainToInstance(JobSearchQueryDto, { searchIn });
  const candidates = (searchIn: unknown) =>
    plainToInstance(CandidateDirectoryQueryDto, { searchIn });

  it('reads a comma list or repeated values into a list', async () => {
    expect(jobs('title, sellerName').searchIn).toEqual(['title', 'sellerName']);
    expect(candidates(['name', 'skills']).searchIn).toEqual(['name', 'skills']);
    expect(await validate(jobs('title,category'))).toEqual([]);
    expect(await validate(candidates('portfolio'))).toEqual([]);
  });

  it('refuses a name that is not on the list (400)', async () => {
    expect((await validate(jobs('title,password')))[0].property).toBe(
      'searchIn',
    );
    expect((await validate(candidates('email')))[0].property).toBe('searchIn');
  });

  it('is optional: without it every field is searched', async () => {
    expect(jobs(undefined).searchIn).toBeUndefined();
    expect(await validate(jobs(undefined))).toEqual([]);
  });
});

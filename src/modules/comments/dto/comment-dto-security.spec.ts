import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateCommentDto } from './create-comment.dto';
import { UpdateCommentDto } from './update-comment.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };

describe('UpdateCommentDto immutable review fields', () => {
  it('rejects moving an existing review to another service', async () => {
    const dto = plainToInstance(UpdateCommentDto, { jobId: 99, content: 'Updated' });
    const errors = await validate(dto, options);
    expect(errors.some((error) => error.property === 'jobId')).toBe(true);
  });
});

describe('CreateCommentDto', () => {
  it('takes a contractId, content and rating', async () => {
    const dto = plainToInstance(CreateCommentDto, { contractId: 4, content: 'Good', rating: 5 });
    expect(await validate(dto, options)).toHaveLength(0);
  });

  it('rejects a body without contractId, and a jobId sent by the client', async () => {
    const noContract = plainToInstance(CreateCommentDto, { content: 'Good', rating: 5 });
    expect((await validate(noContract, options)).some((e) => e.property === 'contractId')).toBe(true);
    const withJob = plainToInstance(CreateCommentDto, { contractId: 4, jobId: 2, content: 'Good', rating: 5 });
    expect((await validate(withJob, options)).some((e) => e.property === 'jobId')).toBe(true);
  });
});

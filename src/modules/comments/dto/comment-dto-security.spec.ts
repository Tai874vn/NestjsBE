import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateCommentDto } from './update-comment.dto';

describe('UpdateCommentDto immutable review fields', () => {
  it('rejects moving an existing review to another service', async () => {
    const dto = plainToInstance(UpdateCommentDto, { jobId: 99, content: 'Updated' });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((error) => error.property === 'jobId')).toBe(true);
  });
});

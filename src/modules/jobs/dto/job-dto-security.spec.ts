import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateJobDto } from './create-job.dto';

describe('CreateJobDto writable fields', () => {
  it.each(['rating', 'reviews', 'image'])('rejects client-controlled %s', async (field) => {
    const dto = plainToInstance(CreateJobDto, {
      title: 'Service',
      price: 20,
      subcategoryId: 1,
      [field]: field === 'image' ? 'https://attacker.example/file' : 5,
    });

    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((error) => error.property === field)).toBe(true);
  });
});

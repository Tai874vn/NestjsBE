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

describe('CreateJobDto price', () => {
  it('lets a portfolio post leave the price out', async () => {
    const dto = plainToInstance(CreateJobDto, { title: 'Checkout redesign case study', subcategoryId: 1 });
    expect(await validate(dto, { whitelist: true, forbidNonWhitelisted: true })).toEqual([]);
  });

  it('still rejects a negative price', async () => {
    const dto = plainToInstance(CreateJobDto, { title: 'Service', subcategoryId: 1, price: -5 });
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.some((error) => error.property === 'price')).toBe(true);
  });
});

import 'reflect-metadata';
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

describe('CreateJobDto service fields', () => {
  const opts = { whitelist: true, forbidNonWhitelisted: true };
  const base = { title: 'Service', subcategoryId: 1 };
  const step = (share: number, title = 'Step') => ({ title, share });
  const bad = async (extra: object, prop: string) => {
    const errors = await validate(plainToInstance(CreateJobDto, { ...base, ...extra }), opts);
    expect(errors.some((error) => error.property === prop)).toBe(true);
  };

  it('accepts a valid mode, area and plan', async () => {
    const dto = plainToInstance(CreateJobDto, {
      ...base,
      workMode: 'BOTH',
      serviceArea: '  Ho Chi Minh City ',
      milestoneTemplate: [step(30), step(40), step(30)],
    });
    expect(await validate(dto, opts)).toEqual([]);
    expect(dto.serviceArea).toBe('Ho Chi Minh City');
  });

  it('accepts null to clear area and plan', async () => {
    const dto = plainToInstance(CreateJobDto, { ...base, serviceArea: null, milestoneTemplate: null });
    expect(await validate(dto, opts)).toEqual([]);
  });

  it('rejects an unknown work mode', () => bad({ workMode: 'MOON' }, 'workMode'));
  it('rejects an area over 160 characters', () => bad({ serviceArea: 'a'.repeat(161) }, 'serviceArea'));
  it('rejects 11 steps', () =>
    bad({ milestoneTemplate: Array.from({ length: 11 }, () => step(9)) }, 'milestoneTemplate'));
  it('rejects an empty plan', () => bad({ milestoneTemplate: [] }, 'milestoneTemplate'));
  it('rejects a step share of 0, 101 or 1.5', async () => {
    for (const share of [0, 101, 1.5]) {
      await bad({ milestoneTemplate: [step(share)] }, 'milestoneTemplate');
    }
  });
  it('rejects a step title over 80 characters', () =>
    bad({ milestoneTemplate: [step(100, 'a'.repeat(81))] }, 'milestoneTemplate'));
});

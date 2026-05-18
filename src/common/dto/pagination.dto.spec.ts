import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationDto } from './pagination.dto';

describe('PaginationDto', () => {
  it('uses default values when optional fields are not provided', async () => {
    const dto = new PaginationDto();
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(10);
  });

  it('transforms and validates numeric query strings', async () => {
    const dto = plainToInstance(PaginationDto, { page: '2', pageSize: '50' });
    const errors = await validate(dto);

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(2);
    expect(dto.pageSize).toBe(50);
  });

  it('fails when page is lower than minimum', async () => {
    const dto = plainToInstance(PaginationDto, { page: '0' });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'page')).toBe(true);
  });

  it('fails when pageSize exceeds maximum', async () => {
    const dto = plainToInstance(PaginationDto, { pageSize: '101' });
    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'pageSize')).toBe(true);
  });
});

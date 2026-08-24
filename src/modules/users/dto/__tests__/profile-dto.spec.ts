import 'reflect-metadata';
import { validate } from 'class-validator';
import { UpdateMyProfileDto } from '../profile.dto';
import { UpdateUserDto } from '../update-user.dto';

describe('Profile DTOs', () => {
  it.each([
    ['UpdateMyProfileDto', UpdateMyProfileDto],
    ['UpdateUserDto', UpdateUserDto],
  ])('validates %s birthDay as YYYY-MM-DD', async (_name, Dto) => {
    const validDto = new Dto();
    validDto.birthDay = '1990-01-01';

    const invalidDto = new Dto();
    invalidDto.birthDay = 'January 1, 1990';

    await expect(validate(validDto)).resolves.toHaveLength(0);
    const errors = await validate(invalidDto);

    expect(errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ property: 'birthDay' })]),
    );
  });

  it('accepts only a boolean candidate discoverability preference', async () => {
    const validDto = new UpdateMyProfileDto();
    validDto.candidateDiscoverable = true;

    const invalidDto = new UpdateMyProfileDto();
    invalidDto.candidateDiscoverable = 'true' as unknown as boolean;

    await expect(validate(validDto)).resolves.toHaveLength(0);
    await expect(validate(invalidDto)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ property: 'candidateDiscoverable' }),
      ]),
    );
  });
});

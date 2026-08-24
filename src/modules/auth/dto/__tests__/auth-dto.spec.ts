import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { SignUpDto } from '../signup.dto';
import { SignInDto } from '../signin.dto';
import { Role } from '../../../../common/constants/roles';

describe('Auth DTOs', () => {
  describe('SignUpDto', () => {
    it('should validate a valid SignUpDto', async () => {
      const dto = new SignUpDto();
      dto.name = 'Test User';
      dto.email = 'test@example.com';
      dto.password = 'password123';
      dto.phone = '1234567890';
      dto.birthDay = '1990-01-01';
      dto.gender = 'male';
      dto.skill = 'JavaScript';
      dto.certification = 'AWS';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail if name is missing', async () => {
      const dto = new SignUpDto();
      dto.email = 'test@example.com';
      dto.password = 'password123';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('name');
    });

    it('should fail if email is invalid', async () => {
      const dto = new SignUpDto();
      dto.name = 'Test User';
      dto.email = 'invalid-email';
      dto.password = 'password123';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('email');
    });

    it('should fail if password is too short', async () => {
      const dto = new SignUpDto();
      dto.name = 'Test User';
      dto.email = 'test@example.com';
      dto.password = '123456789';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('password');
    });

    it('should reject oversized signup fields', async () => {
      const dto = new SignUpDto();
      dto.name = 'x'.repeat(101);
      dto.email = 'test@example.com';
      dto.password = 'x'.repeat(129);

      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'name')).toBe(true);
      expect(errors.some((error) => error.property === 'password')).toBe(true);
    });

    it('should allow optional fields to be undefined', async () => {
      const dto = new SignUpDto();
      dto.name = 'Test User';
      dto.email = 'test@example.com';
      dto.password = 'password123';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should trim names and normalize emails before validation', async () => {
      const dto = plainToInstance(SignUpDto, {
        name: '  Test User  ',
        email: '  TEST@Example.COM ',
        password: 'password123',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.name).toBe('Test User');
      expect(dto.email).toBe('test@example.com');
    });

    it('should allow employer account role', async () => {
      const dto = new SignUpDto();
      dto.name = 'Hiring Manager';
      dto.email = 'hiring@example.com';
      dto.password = 'password123';
      dto.role = Role.EMPLOYER;

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should reject unknown account roles', async () => {
      const dto = new SignUpDto();
      dto.name = 'Hiring Manager';
      dto.email = 'hiring@example.com';
      dto.password = 'password123';
      (dto as { role?: string }).role = 'recruiting-admin';

      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'role')).toBe(true);
    });

    it('should reject public admin signup role', async () => {
      const dto = new SignUpDto();
      dto.name = 'Admin User';
      dto.email = 'admin-signup@example.com';
      dto.password = 'password123';
      (dto as { role?: string }).role = Role.ADMIN;

      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'role')).toBe(true);
    });
  });

  describe('SignInDto', () => {
    it('should validate a valid SignInDto', async () => {
      const dto = new SignInDto();
      dto.email = 'test@example.com';
      dto.password = 'password123';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail if email is missing', async () => {
      const dto = new SignInDto();
      dto.password = 'password123';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('email');
    });

    it('should fail if password is missing', async () => {
      const dto = new SignInDto();
      dto.email = 'test@example.com';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('password');
    });

    it('should fail if password is too long', async () => {
      const dto = new SignInDto();
      dto.email = 'test@example.com';
      dto.password = 'x'.repeat(129);

      const errors = await validate(dto);
      expect(errors.some((error) => error.property === 'password')).toBe(true);
    });

    it('should fail if email format is invalid', async () => {
      const dto = new SignInDto();
      dto.email = 'not-an-email';
      dto.password = 'password123';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('email');
    });

    it('should normalize signin emails before validation', async () => {
      const dto = plainToInstance(SignInDto, {
        email: '  TEST@Example.COM ',
        password: 'password123',
      });

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
      expect(dto.email).toBe('test@example.com');
    });
  });
});

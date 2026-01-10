import { validate } from 'class-validator';
import { SignUpDto } from '../signup.dto';
import { SignInDto } from '../signin.dto';

describe('Auth DTOs', () => {
  describe('SignUpDto', () => {
    it('should validate a valid SignUpDto', async () => {
      const dto = new SignUpDto();
      dto.name = 'Test User';
      dto.email = 'test@example.com';
      dto.passWord = 'password123';
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
      dto.passWord = 'password123';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('name');
    });

    it('should fail if email is invalid', async () => {
      const dto = new SignUpDto();
      dto.name = 'Test User';
      dto.email = 'invalid-email';
      dto.passWord = 'password123';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('email');
    });

    it('should fail if password is too short', async () => {
      const dto = new SignUpDto();
      dto.name = 'Test User';
      dto.email = 'test@example.com';
      dto.passWord = '12345';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('passWord');
    });

    it('should allow optional fields to be undefined', async () => {
      const dto = new SignUpDto();
      dto.name = 'Test User';
      dto.email = 'test@example.com';
      dto.passWord = 'password123';

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
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

    it('should fail if email format is invalid', async () => {
      const dto = new SignInDto();
      dto.email = 'not-an-email';
      dto.password = 'password123';

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].property).toBe('email');
    });
  });
});

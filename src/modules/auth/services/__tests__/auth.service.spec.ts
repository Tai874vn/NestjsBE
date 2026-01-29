import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../../prisma.service';
import { SignUpDto } from '../../dto/signup.dto';
import { SignInDto } from '../../dto/signin.dto';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let prismaService: PrismaService;
  let jwtService: JwtService;

  const mockPrismaService = {
    nguoiDung: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  const mockUser = {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    password: 'hashedPassword123',
    phone: '1234567890',
    birthDay: '1990-01-01',
    gender: 'male',
    role: 'user',
    skill: 'JavaScript',
    certification: 'AWS',
    googleId: null,
    avatar: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: JwtService,
          useValue: mockJwtService,
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    prismaService = module.get<PrismaService>(PrismaService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signUp', () => {
    const signUpDto: SignUpDto = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'password123',
      phone: '1234567890',
      birthDay: '1990-01-01',
      gender: 'male',
      skill: 'JavaScript',
      certification: 'AWS',
    };

    it('should create a new user and return user with token', async () => {
      mockPrismaService.nguoiDung.findUnique.mockResolvedValue(null);
      mockPrismaService.nguoiDung.create.mockResolvedValue(mockUser);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashedPassword123');
      mockJwtService.sign.mockReturnValue('test-jwt-token');

      const result = await service.signUp(signUpDto);

      expect(prismaService.nguoiDung.findUnique).toHaveBeenCalledWith({
        where: { email: signUpDto.email },
      });
      expect(bcrypt.hash).toHaveBeenCalledWith(signUpDto.password, 10);
      expect(prismaService.nguoiDung.create).toHaveBeenCalled();
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
      });
      expect(result.message).toBe('User created successfully');
      expect(result.content.user).not.toHaveProperty('password');
      expect(result.content.token).toBe('test-jwt-token');
    });

    it('should throw ConflictException if email already exists', async () => {
      mockPrismaService.nguoiDung.findUnique.mockResolvedValue(mockUser);

      await expect(service.signUp(signUpDto)).rejects.toThrow(
        ConflictException,
      );
      expect(prismaService.nguoiDung.findUnique).toHaveBeenCalledWith({
        where: { email: signUpDto.email },
      });
      expect(prismaService.nguoiDung.create).not.toHaveBeenCalled();
    });
  });

  describe('signIn', () => {
    const signInDto: SignInDto = {
      email: 'test@example.com',
      password: 'password123',
    };

    it('should return user and token for valid credentials', async () => {
      mockPrismaService.nguoiDung.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      mockJwtService.sign.mockReturnValue('test-jwt-token');

      const result = await service.signIn(signInDto);

      expect(prismaService.nguoiDung.findUnique).toHaveBeenCalledWith({
        where: { email: signInDto.email },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        signInDto.password,
        mockUser.password,
      );
      expect(result.message).toBe('Login successful');
      expect(result.content.user).not.toHaveProperty('password');
      expect(result.content.token).toBe('test-jwt-token');
    });

    it('should throw UnauthorizedException if user not found', async () => {
      mockPrismaService.nguoiDung.findUnique.mockResolvedValue(null);

      await expect(service.signIn(signInDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if password is null', async () => {
      mockPrismaService.nguoiDung.findUnique.mockResolvedValue({
        ...mockUser,
        password: null,
      });

      await expect(service.signIn(signInDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if password is invalid', async () => {
      mockPrismaService.nguoiDung.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(service.signIn(signInDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('googleLogin', () => {
    it('should return user without password and token', () => {
      mockJwtService.sign.mockReturnValue('test-jwt-token');

      const result = service.googleLogin(mockUser);

      expect(result.user).not.toHaveProperty('password');
      expect(result.token).toBe('test-jwt-token');
      expect(jwtService.sign).toHaveBeenCalledWith({
        sub: mockUser.id,
        email: mockUser.email,
      });
    });
  });
});

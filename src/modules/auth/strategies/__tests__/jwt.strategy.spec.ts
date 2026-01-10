import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from '../jwt.strategy';
import { PrismaService } from '../../../../prisma.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prismaService: PrismaService;

  const mockPrismaService = {
    nguoiDung: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('should return user data for valid payload', async () => {
      const payload = {
        sub: 1,
        email: 'test@example.com',
      };

      const mockUser = {
        id: 1,
        email: 'test@example.com',
        role: 'user',
      };

      mockPrismaService.nguoiDung.findUnique.mockResolvedValue(mockUser);

      const result = await strategy.validate(payload);

      expect(prismaService.nguoiDung.findUnique).toHaveBeenCalledWith({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          role: true,
        },
      });
      expect(result).toEqual(mockUser);
    });

    it('should throw UnauthorizedException if user not found', async () => {
      const payload = {
        sub: 999,
        email: 'notfound@example.com',
      };

      mockPrismaService.nguoiDung.findUnique.mockResolvedValue(null);

      await expect(strategy.validate(payload)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });
});

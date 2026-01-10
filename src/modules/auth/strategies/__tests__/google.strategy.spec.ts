import { Test, TestingModule } from '@nestjs/testing';
import { GoogleStrategy } from '../google.strategy';
import { PrismaService } from '../../../../prisma.service';

describe('GoogleStrategy', () => {
  let strategy: GoogleStrategy;
  let prismaService: PrismaService;

  // Set environment variables for OAuth strategy
  beforeAll(() => {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
    process.env.GOOGLE_CALLBACK_URL = 'http://localhost:3000/api/auth/google/callback';
  });

  const mockPrismaService = {
    nguoiDung: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockProfile = {
    id: 'google-id-123',
    displayName: 'Test User',
    emails: [{ value: 'test@example.com', verified: true }],
    photos: [{ value: 'https://example.com/avatar.jpg' }],
    provider: 'google',
    _json: {},
  };

  const mockUser = {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
    passWord: null,
    phone: null,
    birthDay: null,
    gender: null,
    role: 'user',
    skill: null,
    certification: null,
    googleId: 'google-id-123',
    avatar: 'https://example.com/avatar.jpg',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GoogleStrategy,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    strategy = module.get<GoogleStrategy>(GoogleStrategy);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validate', () => {
    it('should return existing user if found by googleId', async () => {
      mockPrismaService.nguoiDung.findUnique.mockResolvedValue(mockUser);

      const done = jest.fn();

      await strategy.validate(
        'access-token',
        'refresh-token',
        mockProfile,
        done,
      );

      expect(prismaService.nguoiDung.findUnique).toHaveBeenCalledWith({
        where: { googleId: mockProfile.id },
      });
      expect(done).toHaveBeenCalledWith(null, mockUser);
    });

    it('should update existing user with googleId if found by email', async () => {
      mockPrismaService.nguoiDung.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockUser);
      mockPrismaService.nguoiDung.update.mockResolvedValue({
        ...mockUser,
        googleId: mockProfile.id,
      });

      const done = jest.fn();

      await strategy.validate(
        'access-token',
        'refresh-token',
        mockProfile,
        done,
      );

      expect(prismaService.nguoiDung.findUnique).toHaveBeenCalledTimes(2);
      expect(prismaService.nguoiDung.update).toHaveBeenCalledWith({
        where: { id: mockUser.id },
        data: { googleId: mockProfile.id },
      });
      expect(done).toHaveBeenCalled();
    });

    it('should create new user if not found', async () => {
      mockPrismaService.nguoiDung.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrismaService.nguoiDung.create.mockResolvedValue(mockUser);

      const done = jest.fn();

      await strategy.validate(
        'access-token',
        'refresh-token',
        mockProfile,
        done,
      );

      expect(prismaService.nguoiDung.create).toHaveBeenCalledWith({
        data: {
          googleId: mockProfile.id,
          email: mockProfile.emails[0].value,
          name: mockProfile.displayName,
          avatar: mockProfile.photos[0].value,
          role: 'user',
        },
      });
      expect(done).toHaveBeenCalledWith(null, mockUser);
    });

    it('should handle profile without photos', async () => {
      const profileWithoutPhotos = {
        ...mockProfile,
        photos: undefined,
      };

      mockPrismaService.nguoiDung.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      mockPrismaService.nguoiDung.create.mockResolvedValue(mockUser);

      const done = jest.fn();

      await strategy.validate(
        'access-token',
        'refresh-token',
        profileWithoutPhotos,
        done,
      );

      expect(prismaService.nguoiDung.create).toHaveBeenCalledWith({
        data: {
          googleId: profileWithoutPhotos.id,
          email: profileWithoutPhotos.emails[0].value,
          name: profileWithoutPhotos.displayName,
          avatar: undefined,
          role: 'user',
        },
      });
    });
  });
});

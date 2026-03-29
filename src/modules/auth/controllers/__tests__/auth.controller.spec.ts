import { Test, TestingModule } from '@nestjs/testing';
import { AuthController } from '../auth.controller';
import { AuthService } from '../../services/auth.service';
import { SignUpDto } from '../../dto/signup.dto';
import { SignInDto } from '../../dto/signin.dto';

describe('AuthController', () => {
  let controller: AuthController;
  let authService: AuthService;

  const mockAuthService = {
    signUp: jest.fn(),
    signIn: jest.fn(),
    googleLogin: jest.fn(),
  };

  const mockUser = {
    id: 1,
    name: 'Test User',
    email: 'test@example.com',
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
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: mockAuthService,
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
    authService = module.get<AuthService>(AuthService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('signUp', () => {
    it('should call authService.signUp and return the result', async () => {
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

      const expectedResult = {
        message: 'User created successfully',
        content: {
          user: mockUser,
          token: 'test-jwt-token',
          refreshToken: 'test-refresh-token',
        },
      };

      const mockResponse = {
        cookie: jest.fn(),
      } as any;

      mockAuthService.signUp.mockResolvedValue(expectedResult);

      const result = await controller.signUp(signUpDto, mockResponse);

      expect(authService.signUp).toHaveBeenCalledWith(signUpDto);
      expect(mockResponse.cookie).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        message: expectedResult.message,
        content: { user: expectedResult.content.user },
      });
    });
  });

  describe('signIn', () => {
    it('should call authService.signIn and return the result', async () => {
      const signInDto: SignInDto = {
        email: 'test@example.com',
        password: 'password123',
      };

      const expectedResult = {
        message: 'Login successful',
        content: {
          user: mockUser,
          token: 'test-jwt-token',
          refreshToken: 'test-refresh-token',
        },
      };

      const mockResponse = {
        cookie: jest.fn(),
      } as any;

      mockAuthService.signIn.mockResolvedValue(expectedResult);

      const result = await controller.signIn(signInDto, mockResponse);

      expect(authService.signIn).toHaveBeenCalledWith(signInDto);
      expect(mockResponse.cookie).toHaveBeenCalledTimes(2);
      expect(result).toEqual({
        message: expectedResult.message,
        content: { user: expectedResult.content.user },
      });
    });
  });

  describe('googleAuth', () => {
    it('should be defined', () => {
      expect(controller.googleAuth).toBeDefined();
    });
  });

  describe('googleAuthRedirect', () => {
    it('should redirect to frontend with cookies set', async () => {
      const mockRequest = {
        user: { ...mockUser, password: 'hashedPassword' },
      } as any;

      const mockResponse = {
        cookie: jest.fn(),
        redirect: jest.fn(),
      } as any;

      mockAuthService.googleLogin.mockResolvedValue({
        user: mockUser,
        token: 'test-jwt-token',
        refreshToken: 'test-refresh-token',
      });

      await controller.googleAuthRedirect(mockRequest, mockResponse);

      expect(authService.googleLogin).toHaveBeenCalledWith(mockRequest.user);
      expect(mockResponse.cookie).toHaveBeenCalledTimes(2);
      expect(mockResponse.redirect).toHaveBeenCalledWith(
        'http://localhost:5173/auth/callback',
      );
    });

    it('should throw error if user is not authenticated', async () => {
      const mockRequest = {
        user: undefined,
      } as any;

      const mockResponse = {
        cookie: jest.fn(),
        redirect: jest.fn(),
      } as any;

      await expect(
        controller.googleAuthRedirect(mockRequest, mockResponse),
      ).rejects.toThrow('User not authenticated');
    });
  });
});

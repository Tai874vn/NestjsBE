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
        },
      };

      mockAuthService.signUp.mockResolvedValue(expectedResult);

      const result = await controller.signUp(signUpDto);

      expect(authService.signUp).toHaveBeenCalledWith(signUpDto);
      expect(result).toEqual(expectedResult);
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
        },
      };

      mockAuthService.signIn.mockResolvedValue(expectedResult);

      const result = await controller.signIn(signInDto);

      expect(authService.signIn).toHaveBeenCalledWith(signInDto);
      expect(result).toEqual(expectedResult);
    });
  });

  describe('googleAuth', () => {
    it('should be defined', () => {
      expect(controller.googleAuth).toBeDefined();
    });
  });

  describe('googleAuthRedirect', () => {
    it('should redirect to frontend with token', () => {
      const mockRequest = {
        user: { ...mockUser, passWord: 'hashedPassword' },
      } as any;

      const mockResponse = {
        redirect: jest.fn(),
      } as any;

      mockAuthService.googleLogin.mockReturnValue({
        user: mockUser,
        token: 'test-jwt-token',
      });

      controller.googleAuthRedirect(mockRequest, mockResponse);

      expect(authService.googleLogin).toHaveBeenCalledWith(mockRequest.user);
      expect(mockResponse.redirect).toHaveBeenCalledWith(
        'http://localhost:5173/auth/callback?token=test-jwt-token',
      );
    });

    it('should throw error if user is not authenticated', () => {
      const mockRequest = {
        user: undefined,
      } as any;

      const mockResponse = {
        redirect: jest.fn(),
      } as any;

      expect(() =>
        controller.googleAuthRedirect(mockRequest, mockResponse),
      ).toThrow('User not authenticated');
    });
  });
});

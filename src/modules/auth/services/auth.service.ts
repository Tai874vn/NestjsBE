import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { SignUpDto } from '../dto/signup.dto';
import { SignInDto } from '../dto/signin.dto';
import { ApiResponse } from '../../../types';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type NguoiDungType = Prisma.NguoiDungGetPayload<{}>;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async signUp(signUpDto: SignUpDto): Promise<
    ApiResponse<{
      user: Omit<NguoiDungType, 'passWord' | 'refreshToken'>;
      token: string;
      refreshToken: string;
    }>
  > {
    const existingUser: NguoiDungType | null =
      await this.prisma.nguoiDung.findUnique({
        where: { email: signUpDto.email },
      });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword: string = await bcrypt.hash(
      signUpDto.password as string,
      10,
    );

    const user: NguoiDungType = await this.prisma.nguoiDung.create({
      data: {
        name: signUpDto.name,
        email: signUpDto.email,
        passWord: hashedPassword,
        phone: signUpDto.phone,
        birthDay: signUpDto.birthDay,
        gender: signUpDto.gender,
        skill: signUpDto.skill,
        certification: signUpDto.certification,
        role: 'user',
      },
    });

    const token: string = this.generateToken(user.id, user.email);
    const refreshToken: string = this.generateRefreshToken(user.id, user.email);
    await this.updateRefreshToken(user.id, refreshToken);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passWord, refreshToken: _, ...result } = user;

    return {
      message: 'User created successfully',
      content: {
        user: result,
        token,
        refreshToken,
      },
    };
  }

  async signIn(signInDto: SignInDto): Promise<
    ApiResponse<{
      user: Omit<NguoiDungType, 'passWord' | 'refreshToken'>;
      token: string;
      refreshToken: string;
    }>
  > {
    const user: NguoiDungType | null = await this.prisma.nguoiDung.findUnique({
      where: { email: signInDto.email },
    });

    if (!user || !user.passWord) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid: boolean = await bcrypt.compare(
      signInDto.password,
      user.passWord,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const token: string = this.generateToken(user.id, user.email);
    const refreshToken: string = this.generateRefreshToken(user.id, user.email);
    await this.updateRefreshToken(user.id, refreshToken);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passWord, refreshToken: _, ...result } = user;

    return {
      message: 'Login successful',
      content: {
        user: result,
        token,
        refreshToken,
      },
    };
  }

  async googleLogin(user: NguoiDungType): Promise<{
    user: Omit<NguoiDungType, 'passWord' | 'refreshToken'>;
    token: string;
    refreshToken: string;
  }> {
    const token: string = this.generateToken(user.id, user.email);
    const refreshToken: string = this.generateRefreshToken(user.id, user.email);
    await this.updateRefreshToken(user.id, refreshToken);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passWord, refreshToken: _, ...result } = user;

    return {
      user: result,
      token,
      refreshToken,
    };
  }

  async getCurrentUser(
    userId: number,
  ): Promise<ApiResponse<Omit<NguoiDungType, 'passWord' | 'refreshToken'>>> {
    if (!userId) {
      throw new UnauthorizedException('User ID is required');
    }

    const user = await this.prisma.nguoiDung.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        birthDay: true,
        gender: true,
        role: true,
        skill: true,
        certification: true,
        googleId: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return {
      message: 'Get current user successfully',
      content: user,
    };
  }

  private generateToken(userId: number, email: string): string {
    const payload: { sub: number; email: string } = { sub: userId, email };
    return this.jwtService.sign(payload);
  }

  private generateRefreshToken(userId: number, email: string): string {
    const payload: { sub: number; email: string } = { sub: userId, email };
    return this.jwtService.sign(payload, { expiresIn: '30d' });
  }

  async updateRefreshToken(
    userId: number,
    refreshToken: string,
  ): Promise<void> {
    const hashedRefreshToken = await bcrypt.hash(refreshToken, 10);
    await this.prisma.nguoiDung.update({
      where: { id: userId },
      data: { refreshToken: hashedRefreshToken },
    });
  }

  async refreshTokens(
    userId: number,
    refreshToken: string,
  ): Promise<{ accessToken: string; refreshToken: string }> {
    const user = await this.prisma.nguoiDung.findUnique({
      where: { id: userId },
    });

    if (!user || !user.refreshToken) {
      throw new UnauthorizedException('Access Denied');
    }

    const refreshTokenMatches = await bcrypt.compare(
      refreshToken,
      user.refreshToken as string,
    );

    if (!refreshTokenMatches) {
      throw new UnauthorizedException('Access Denied');
    }

    const newAccessToken = this.generateToken(user.id, user.email);
    const newRefreshToken = this.generateRefreshToken(user.id, user.email);
    await this.updateRefreshToken(user.id, newRefreshToken);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  async logout(userId: number): Promise<void> {
    await this.prisma.nguoiDung.update({
      where: { id: userId },
      data: { refreshToken: null },
    });
  }
}

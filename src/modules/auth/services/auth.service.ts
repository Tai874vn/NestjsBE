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
      user: Omit<NguoiDungType, 'passWord'>;
      token: string;
    }>
  > {
    const existingUser: NguoiDungType | null =
      await this.prisma.nguoiDung.findUnique({
        where: { email: signUpDto.email },
      });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword: string = await bcrypt.hash(signUpDto.passWord, 10);

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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passWord, ...result } = user;
    const token: string = this.generateToken(user.id, user.email);

    return {
      message: 'User created successfully',
      content: {
        user: result,
        token,
      },
    };
  }

  async signIn(
    signInDto: SignInDto,
  ): Promise<
    ApiResponse<{ user: Omit<NguoiDungType, 'passWord'>; token: string }>
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passWord, ...result } = user;
    const token: string = this.generateToken(user.id, user.email);

    return {
      message: 'Login successful',
      content: {
        user: result,
        token,
      },
    };
  }

  googleLogin(user: NguoiDungType): {
    user: Omit<NguoiDungType, 'passWord'>;
    token: string;
  } {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passWord, ...result } = user;
    const token: string = this.generateToken(user.id, user.email);

    return {
      user: result,
      token,
    };
  }

  private generateToken(userId: number, email: string): string {
    const payload: { sub: number; email: string } = { sub: userId, email };
    return this.jwtService.sign(payload);
  }
}

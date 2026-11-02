import {
  Injectable,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { User } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { SignUpDto } from '../dto/signup.dto';
import { SignInDto } from '../dto/signin.dto';
import { ApiResponse } from '../../../types';
import { Role } from '../../../common/constants/roles';
import {
  AuthSessionService,
  SessionMetadata,
} from '../session/auth-session.service';

type UserType = User;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private readonly sessions: AuthSessionService,
  ) {}

  async signUp(
    signUpDto: SignUpDto,
    metadata: SessionMetadata = {},
  ): Promise<
    ApiResponse<{
      user: Omit<UserType, 'password' | 'refreshToken'>;
      token: string;
      refreshToken: string;
      logoutToken: string;
      refreshExpiresAt: Date;
    }>
  > {
    const email = this.normalizeEmail(signUpDto.email);
    const existingUser: UserType | null = await this.findUserByEmail(email);

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword: string = await bcrypt.hash(signUpDto.password, 10);

    const user: UserType = await this.prisma.user.create({
      data: {
        name: signUpDto.name,
        email,
        password: hashedPassword,
        phone: signUpDto.phone,
        birthDay: signUpDto.birthDay,
        gender: signUpDto.gender,
        skill: signUpDto.skill,
        certification: signUpDto.certification,
        headline: signUpDto.headline,
        bio: signUpDto.bio,
        location: signUpDto.location,
        website: signUpDto.website,
        role: signUpDto.role ?? Role.USER,
        candidateDiscoverable: true,
      },
    });

    const { token, refreshToken, logoutToken, refreshExpiresAt } =
      await this.sessions.create(user.id, metadata);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, refreshToken: _, ...result } = user;

    return {
      message: 'User created successfully',
      content: {
        user: result,
        token,
        refreshToken,
        logoutToken,
        refreshExpiresAt,
      },
    };
  }

  async signIn(
    signInDto: SignInDto,
    metadata: SessionMetadata = {},
  ): Promise<
    ApiResponse<{
      user: Omit<UserType, 'password' | 'refreshToken'>;
      token: string;
      refreshToken: string;
      logoutToken: string;
      refreshExpiresAt: Date;
    }>
  > {
    const user: UserType | null = await this.findUserByEmail(
      this.normalizeEmail(signInDto.email),
    );

    if (!user || !user.password || user.bannedAt) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid: boolean = await bcrypt.compare(
      signInDto.password,
      user.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const { token, refreshToken, logoutToken, refreshExpiresAt } =
      await this.sessions.create(user.id, metadata, user.password);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, refreshToken: _, ...result } = user;

    return {
      message: 'Login successful',
      content: {
        user: result,
        token,
        refreshToken,
        logoutToken,
        refreshExpiresAt,
      },
    };
  }

  async googleLogin(
    user: { id: number },
    metadata: SessionMetadata = {},
  ): Promise<{
    token: string;
    refreshToken: string;
    logoutToken: string;
    refreshExpiresAt: Date;
  }> {
    const { token, refreshToken, logoutToken, refreshExpiresAt } =
      await this.sessions.create(user.id, metadata);

    return {
      token,
      refreshToken,
      logoutToken,
      refreshExpiresAt,
    };
  }

  async getCurrentUser(userId: number) {
    if (!userId) {
      throw new UnauthorizedException('User ID is required');
    }

    const user = await this.prisma.user.findUnique({
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
        headline: true,
        bio: true,
        location: true,
        website: true,
        googleId: true,
        avatar: true,
        coverImage: true,
        profileCompleted: true,
        candidateDiscoverable: true,
        createdAt: true,
        updatedAt: true,
        profileSkills: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
        profileCertifications: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
        portfolioItems: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const { skill, certification, ...profile } = user;

    return {
      message: 'Get current user successfully',
      content: {
        ...profile,
        profileSkills: this.withLegacyProfileRows(
          user.profileSkills,
          skill,
          (name, index) => ({
            id: 0 - index,
            name,
            level: null,
            sortOrder: index,
            createdAt: null,
            updatedAt: null,
          }),
        ),
        profileCertifications: this.withLegacyProfileRows(
          user.profileCertifications,
          certification,
          (name, index) => ({
            id: 0 - index,
            userId: null,
            name,
            issuer: null,
            issuedAt: null,
            expiresAt: null,
            credentialUrl: null,
            credentialId: null,
            sortOrder: index,
            createdAt: null,
            updatedAt: null,
          }),
        ),
      },
    };
  }

  refreshTokens(refreshToken: string) {
    return this.sessions.refresh(refreshToken);
  }

  async logout(
    refreshToken?: string,
    logoutCredential?: string,
  ): Promise<void> {
    if (refreshToken) await this.sessions.logoutToken(refreshToken);
    else if (logoutCredential)
      await this.sessions.logoutCredentialToken(logoutCredential);
  }

  private withLegacyProfileRows<T extends { name: string }, FallbackRow>(
    rows: T[],
    legacyValue: string | null,
    createFallbackRow: (name: string, index: number) => FallbackRow,
  ): Array<T | FallbackRow> {
    const normalizedRows = this.normalizeProfileRows(rows);
    if (normalizedRows.length > 0) {
      return normalizedRows;
    }

    return this.parseStringArrayValue(legacyValue).map(createFallbackRow);
  }

  private normalizeProfileRows<T extends { name: string }>(rows: T[]): T[] {
    const seenNames = new Set<string>();

    return rows.flatMap((row) =>
      this.parseStringArrayValue(row.name).flatMap((name) => {
        const key = name.toLowerCase();
        if (seenNames.has(key)) {
          return [];
        }

        seenNames.add(key);
        return [{ ...row, name }];
      }),
    );
  }

  private parseStringArrayValue(value?: string | null): string[] {
    if (!value) {
      return [];
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed.flatMap((item) =>
          typeof item === 'string' ? this.parseStringArrayValue(item) : [],
        );
      }
    } catch {
      return [trimmed];
    }

    return [trimmed];
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private findUserByEmail(email: string): Promise<UserType | null> {
    const normalizedEmail = this.normalizeEmail(email);
    return this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      orderBy: { id: 'asc' },
    });
  }
}

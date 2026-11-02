import {
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthSession, Prisma, User } from '@prisma/client';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import * as bcrypt from 'bcrypt';
import { StringValue } from 'ms';
import { PrismaService } from '../../../prisma.service';
import { Role } from '../../../common/constants/roles';
import { AuthRedisService } from './auth-redis.service';
import { jwtVerifyOptions } from './auth-jwt.config';

type SessionUser = Pick<
  User,
  'id' | 'role' | 'tokenVersion' | 'bannedAt' | 'password'
>;
type SessionWithUser = AuthSession & { user: SessionUser };
export type SessionMetadata = { userAgent?: string; ip?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function refreshDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function matchesDigest(token: string, hash: string): boolean {
  const digest = Buffer.from(refreshDigest(token), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return expected.length === digest.length && timingSafeEqual(digest, expected);
}

@Injectable()
export class AuthSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: AuthRedisService,
    private readonly config: ConfigService,
  ) {}

  onRevoked(listener: (sid: string) => void): () => void {
    return this.redis.onRevocation(listener);
  }

  async assertAccessSession(
    sid: string,
    userId: number,
    jti?: string,
  ): Promise<void> {
    if (jti && (await this.redis.isAccessRevoked(jti)))
      this.reject('SESSION_REVOKED');
    const cached = await this.redis.readSession(sid);
    if (cached === undefined) return; // Explicit access-only fail-open policy.
    if (cached) {
      if (cached.revoked || cached.userId !== userId)
        this.reject('SESSION_REVOKED');
      return;
    }
    const session = await this.database(() =>
      this.prisma.authSession.findUnique({
        where: { id: sid },
        include: { user: true },
      }),
    );
    if (
      !session ||
      session.userId !== userId ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user?.bannedAt ||
      (session.user && session.tokenVersion !== session.user.tokenVersion)
    ) {
      this.reject('SESSION_REVOKED');
    }
    await this.redis.writeSession(sid, userId, session.expiresAt);
  }

  async create(
    userId: number,
    metadata: SessionMetadata = {},
    expectedPasswordHash?: string,
  ) {
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() +
        Number(this.config.get('AUTH_REFRESH_TTL_DAYS') ?? 14) * 86_400_000,
    );
    const sid = randomUUID();
    const familyId = randomUUID();
    const refresh = this.newRefresh();
    const session = await this.database(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, userId);
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (
          !user ||
          user.bannedAt ||
          !Object.values(Role).includes(user.role as Role)
        )
          this.reject('SESSION_REVOKED');
        if (expectedPasswordHash && user.password !== expectedPasswordHash)
          this.reject('INVALID_CREDENTIALS');
        return tx.authSession.create({
          data: {
            id: sid,
            familyId,
            userId,
            tokenVersion: user.tokenVersion,
            userAgent: metadata.userAgent?.slice(0, 512),
            ip: metadata.ip?.slice(0, 64),
            expiresAt,
            refreshTokens: {
              create: {
                id: refresh.id,
                tokenHash: refreshDigest(refresh.token),
                expiresAt,
              },
            },
          },
          include: { user: true },
        });
      }),
    );
    await this.redis.writeSession(sid, userId, expiresAt);
    await this.cacheRefresh(
      refresh.id,
      refreshDigest(refresh.token),
      session,
      expiresAt,
    );
    return {
      token: await this.access(session),
      refreshToken: refresh.token,
      logoutToken: this.logoutCredential(session),
      sessionId: sid,
      refreshExpiresAt: expiresAt,
    };
  }

  async refresh(token: string) {
    const id = this.refreshId(token);
    const cached = await this.redis.readRefresh(id);
    if (cached && !matchesDigest(token, cached.tokenHash))
      this.reject('INVALID_REFRESH_TOKEN');
    let initial: {
      tokenHash: string;
      sessionId: string;
      expiresAt: Date;
      session: { userId: number };
    };
    if (cached) {
      initial = {
        tokenHash: cached.tokenHash,
        sessionId: cached.sessionId,
        expiresAt: new Date(cached.expiresAt),
        session: { userId: cached.userId },
      };
    } else {
      const row = await this.database(() =>
        this.prisma.authRefreshToken.findUnique({
          where: { id },
          include: { session: true },
        }),
      );
      if (!row || !matchesDigest(token, row.tokenHash))
        this.reject('INVALID_REFRESH_TOKEN');
      initial = row;
      await this.cacheRefresh(
        id,
        row.tokenHash,
        row.session,
        row.expiresAt,
        row.usedAt,
        row.revokedAt,
      );
    }

    // Lock the user before the session in every mutation to serialize ban,
    // password changes and refresh without a cross-store transaction.
    const outcome = await this.database(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, initial.session.userId);
        await tx.$queryRaw`SELECT "id" FROM "auth_sessions" WHERE "id" = ${initial.sessionId}::uuid FOR UPDATE`;
        const row = await tx.authRefreshToken.findUnique({
          where: { id },
          include: { session: { include: { user: true } } },
        });
        if (
          !row ||
          row.sessionId !== initial.sessionId ||
          row.session.userId !== initial.session.userId ||
          !matchesDigest(token, row.tokenHash)
        )
          return { code: 'INVALID_REFRESH_TOKEN' } as const;
        const session = row.session;
        const now = new Date();
        if (
          session.revokedAt ||
          session.user.bannedAt ||
          session.tokenVersion !== session.user.tokenVersion
        )
          return { code: 'SESSION_REVOKED', session } as const;
        if (session.expiresAt <= now || row.expiresAt <= now)
          return { code: 'REFRESH_TOKEN_EXPIRED', session } as const;
        if (row.usedAt) {
          await tx.authSession.update({
            where: { id: session.id },
            data: { revokedAt: now },
          });
          await tx.authRefreshToken.updateMany({
            where: { sessionId: session.id, revokedAt: null },
            data: { revokedAt: now },
          });
          return { code: 'REFRESH_REUSED', session } as const;
        }
        if (row.revokedAt) return { code: 'SESSION_REVOKED', session } as const;
        if (!Object.values(Role).includes(session.user.role as Role))
          return { code: 'SESSION_REVOKED', session } as const;
        const next = this.newRefresh();
        await tx.authRefreshToken.create({
          data: {
            id: next.id,
            sessionId: session.id,
            tokenHash: refreshDigest(next.token),
            expiresAt: session.expiresAt,
          },
        });
        await tx.authRefreshToken.update({
          where: { id },
          data: { usedAt: now, replacedById: next.id },
        });
        return { next, session, usedAt: now } as const;
      }),
    );
    if ('code' in outcome && outcome.code) {
      if ('session' in outcome && outcome.session)
        await this.invalidate(outcome.session);
      this.reject(outcome.code);
    }
    await this.cacheRefresh(
      id,
      initial.tokenHash,
      outcome.session,
      initial.expiresAt,
      outcome.usedAt,
    );
    await this.cacheRefresh(
      outcome.next.id,
      refreshDigest(outcome.next.token),
      outcome.session,
      outcome.session.expiresAt,
    );
    await this.redis.writeSession(
      outcome.session.id,
      outcome.session.userId,
      outcome.session.expiresAt,
    );
    return {
      accessToken: await this.access(outcome.session),
      refreshToken: outcome.next.token,
      logoutToken: this.logoutCredential(outcome.session),
      sessionId: outcome.session.id,
      refreshExpiresAt: outcome.session.expiresAt,
    };
  }

  async logoutCredentialToken(token: string): Promise<void> {
    let payload: { sub: number; sid: string; type: string };
    try {
      payload = this.jwt.verify(token, jwtVerifyOptions());
    } catch {
      return;
    }
    if (
      payload.type !== 'logout' ||
      !UUID.test(payload.sid ?? '') ||
      !Number.isInteger(payload.sub)
    )
      return;
    await this.revoke(payload.sid, payload.sub);
  }

  private logoutCredential(session: AuthSession): string {
    return this.jwt.sign(
      {
        sub: session.userId,
        sid: session.id,
        jti: randomUUID(),
        type: 'logout',
      },
      {
        algorithm: 'HS256',
        issuer: jwtVerifyOptions().issuer,
        audience: jwtVerifyOptions().audience,
        expiresIn: Math.max(
          1,
          Math.floor((session.expiresAt.getTime() - Date.now()) / 1000),
        ),
      },
    );
  }

  async logoutToken(token: string): Promise<void> {
    let id: string;
    try {
      id = this.refreshId(token);
    } catch {
      return;
    }
    const row = await this.database(() =>
      this.prisma.authRefreshToken.findUnique({
        where: { id },
        include: { session: true },
      }),
    );
    if (row && matchesDigest(token, row.tokenHash))
      await this.revoke(row.session.id, row.session.userId);
  }

  async revoke(sid: string, actorId: number, isAdmin = false): Promise<void> {
    const original = await this.database(() =>
      this.prisma.authSession.findUnique({ where: { id: sid } }),
    );
    if (!original || (!isAdmin && original.userId !== actorId))
      throw new NotFoundException('Session not found');
    await this.database(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, original.userId);
        await tx.authSession.update({
          where: { id: sid },
          data: { revokedAt: new Date() },
        });
        await tx.authRefreshToken.updateMany({
          where: { sessionId: sid, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }),
    );
    await this.invalidate(original);
  }

  list(userId: number) {
    return this.database(() =>
      this.prisma.authSession.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          familyId: true,
          userAgent: true,
          ip: true,
          createdAt: true,
          expiresAt: true,
        },
      }),
    );
  }

  async logoutAll(userId: number): Promise<void> {
    const sessions = await this.database(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, userId);
        await tx.user.update({
          where: { id: userId },
          data: { tokenVersion: { increment: 1 } },
        });
        return this.revokeUser(tx, userId);
      }),
    );
    await this.invalidateMany(sessions);
  }

  async deleteUser(userId: number): Promise<void> {
    const sessions = await this.database(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, userId);
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        const active = await tx.authSession.findMany({
          where: { userId, revokedAt: null },
        });
        await tx.user.delete({ where: { id: userId } });
        return active;
      }),
    );
    await this.invalidateMany(sessions);
  }

  async changePassword(
    userId: number,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.database(() =>
      this.prisma.user.findUnique({ where: { id: userId } }),
    );
    if (
      !user?.password ||
      !(await bcrypt.compare(currentPassword, user.password))
    )
      this.reject('INVALID_CREDENTIALS');
    const password = await bcrypt.hash(newPassword, 12);
    const sessions = await this.database(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, userId);
        const current = await tx.user.findUnique({ where: { id: userId } });
        if (current?.password !== user.password)
          this.reject('INVALID_CREDENTIALS');
        await tx.user.update({
          where: { id: userId },
          data: { password, tokenVersion: { increment: 1 } },
        });
        return this.revokeUser(tx, userId);
      }),
    );
    await this.invalidateMany(sessions);
  }

  async setBanned(
    userId: number,
    banned: boolean,
    actorId: number,
  ): Promise<void> {
    if (userId === actorId)
      throw new ForbiddenException('Cannot change your own ban status');
    const sessions = await this.database(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, userId);
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        await tx.user.update({
          where: { id: userId },
          data: {
            bannedAt: banned ? new Date() : null,
            tokenVersion: { increment: 1 },
          },
        });
        return this.revokeUser(tx, userId);
      }),
    );
    await this.invalidateMany(sessions);
  }

  private async access(session: SessionWithUser): Promise<string> {
    const jti = randomUUID();
    const expiresIn = String(
      this.config.get('JWT_EXPIRES_IN') ?? '10m',
    ) as StringValue;
    const token = this.jwt.sign(
      {
        sub: session.userId,
        role: session.user.role,
        sid: session.id,
        ver: session.user.tokenVersion,
        jti,
        type: 'access',
      },
      {
        algorithm: 'HS256',
        issuer: jwtVerifyOptions().issuer,
        audience: jwtVerifyOptions().audience,
        expiresIn,
      },
    );
    const decoded = this.jwt.decode<{ exp: number }>(token);
    await this.redis.registerAccess(
      session.id,
      jti,
      new Date(decoded.exp * 1000),
    );
    return token;
  }

  private newRefresh() {
    const id = randomUUID();
    return { id, token: `${id}.${randomBytes(32).toString('base64url')}` };
  }

  private refreshId(token: string): string {
    const [id, secret, extra] = token.split('.');
    if (
      !UUID.test(id ?? '') ||
      !/^[A-Za-z0-9_-]{43}$/.test(secret ?? '') ||
      extra !== undefined
    )
      this.reject('INVALID_REFRESH_TOKEN');
    return id;
  }

  private cacheRefresh(
    id: string,
    tokenHash: string,
    session: AuthSession,
    expiresAt: Date,
    usedAt?: Date | null,
    revokedAt?: Date | null,
  ) {
    return this.redis.writeRefresh({
      id,
      tokenHash,
      sessionId: session.id,
      familyId: session.familyId,
      userId: session.userId,
      expiresAt: expiresAt.toISOString(),
      usedAt: usedAt?.toISOString(),
      revokedAt: revokedAt?.toISOString(),
    });
  }

  private async invalidate(session: AuthSession) {
    await this.redis.revokeSession(
      session.id,
      session.userId,
      session.expiresAt,
    );
    await this.redis.publishRevocation(session.id);
  }

  private async invalidateMany(sessions: AuthSession[]) {
    for (const session of sessions) await this.invalidate(session);
  }

  private async revokeUser(tx: Prisma.TransactionClient, userId: number) {
    const sessions = await tx.authSession.findMany({
      where: { userId, revokedAt: null },
    });
    await tx.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.authRefreshToken.updateMany({
      where: { session: { userId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return sessions;
  }

  private lockUser(tx: Prisma.TransactionClient, userId: number) {
    return tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
  }

  private reject(code: string): never {
    throw new UnauthorizedException({
      statusCode: 401,
      code,
      message:
        code === 'REFRESH_REUSED'
          ? 'Refresh token reuse detected; session revoked'
          : 'Authentication session is invalid or revoked',
    });
  }

  private async database<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException({
        statusCode: 503,
        code: 'AUTH_UNAVAILABLE',
        message: 'Authentication storage is unavailable',
      });
    }
  }
}

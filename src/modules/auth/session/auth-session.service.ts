/**
 * Service in the auth module that manages login sessions, refresh token rotation, reuse detection, password changes and resets, account deletion, and user bans. It stores sessions in PostgreSQL and caches revocations and tokens in Redis.
 *
 * Calls: prisma.authSession; prisma.authRefreshToken; prisma.user; prisma.contract; AuthRedisService; JwtService; jwtVerifyOptions; bcrypt
 * Used by:
 *   - 9 files, for example src/modules/auth/auth.module.ts, src/modules/auth/controllers/auth-sessions.controller.ts, src/modules/auth/services/auth.service.ts
 */

import {
  ConflictException,
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
/** Said (409) when an account with contracts is deleted. */
export const ACCOUNT_HAS_CONTRACTS =
  'This account has contracts, so it cannot be deleted. Contract history and paid work must stay.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * We never store a refresh token itself, only its SHA-256 hash (a fixed-length
 * fingerprint of the text). If the database leaks, the stolen hashes cannot be
 * used as tokens.
 */
export function refreshDigest(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Compare a token with a saved hash. timingSafeEqual takes the same time
 * whether the first or the last character differs, so an attacker cannot
 * guess the hash by measuring how fast we answer.
 */
function matchesDigest(token: string, hash: string): boolean {
  const digest = Buffer.from(refreshDigest(token), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return expected.length === digest.length && timingSafeEqual(digest, expected);
}

/**
 * LOGIN SESSIONS — one session = one logged-in browser.
 *
 * Where the data lives:
 *  - PostgreSQL (the main database) is the source of truth: tables
 *    auth_sessions and auth_refresh_tokens.
 *  - Redis (a very fast in-memory key-value store) keeps a copy, so checking
 *    "is this session still valid?" on every request does not hit the database.
 *
 * Main ideas:
 *  - Refresh token rotation: every refresh gives a NEW refresh token and marks
 *    the old one as used. If a used one is ever sent again, someone copied it,
 *    so we cancel the whole session (reuse detection).
 *  - tokenVersion: a number on the user. Changing the password or banning the
 *    user increases it, and every session with the old number stops working.
 */
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

  /**
   * Called on every logged-in request (from JwtStrategy): is this session still alive?
   *  1. Was this exact access token cancelled? (jti = the token's unique id)
   *  2. Ask Redis first (fast). If Redis is down, we let the request through —
   *     the access token is short-lived (10 minutes), so the risk is small.
   *  3. If Redis does not know the session, read it from the database, check it
   *     (not revoked, not expired, user not banned, same tokenVersion), and
   *     save it to Redis for next time.
   */
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

  /**
   * Start a new session after a successful login.
   *  1. Pick random ids: sid (session id) and the first refresh token.
   *  2. In one database transaction (several writes that succeed or fail
   *     together): lock the user row, check the user may log in, then save the
   *     session and the hash of its refresh token.
   *  3. Copy the session to Redis.
   *  4. Return the signed access token (JWT) and the refresh token.
   */
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

  /**
   * Swap a refresh token for a new access token + a new refresh token.
   *  1. Find the token (Redis first, else the database) and check its hash.
   *  2. Inside a transaction, lock the user and the session rows
   *     (SELECT ... FOR UPDATE = "nobody else may change these rows until I
   *     finish"), so two refreshes at the same moment cannot both succeed.
   *  3. Refuse if the session is revoked/expired or the user is banned.
   *  4. Token already used before? → it was stolen or copied: cancel the
   *     whole session (REFRESH_REUSED).
   *  5. Otherwise save a new refresh token and mark the old one "used".
   *  6. Update Redis and return the new tokens.
   */
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

  // DELETE /api/auth/sessions/:id — Signs one device out: marks the session revoked and kills its refresh tokens.
  // Query: authSession.findUnique, authSession.update, authRefreshToken.updateMany, $transaction
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

  // GET /api/auth/sessions — The signed-in devices (sessions) of one user, newest first.
  // Query: authSession.findMany
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

  // POST /api/auth/logout-all — Signs the user out on every device (raises the token version).
  // Query: user.update, $transaction
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

  /**
   * Delete an account. An account that is the client or the freelancer of any contract cannot be
   * deleted (409): the contract history and the paid work must stay for the other person, and
   * held credits would be lost. The database refuses it too (RESTRICT); that case is also 409.
   */
  async deleteUser(userId: number): Promise<void> {
    const sessions = await this.database(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, userId);
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        const contracts = await tx.contract.count({
          where: { OR: [{ clientId: userId }, { freelancerId: userId }] },
        });
        if (contracts > 0) throw new ConflictException(ACCOUNT_HAS_CONTRACTS);
        const active = await tx.authSession.findMany({
          where: { userId, revokedAt: null },
        });
        try {
          await tx.user.delete({ where: { id: userId } });
        } catch (error) {
          // P2003 = a foreign key refused the delete (a contract was made in the meantime).
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2003'
          ) {
            throw new ConflictException(ACCOUNT_HAS_CONTRACTS);
          }
          throw error;
        }
        return active;
      }),
    );
    await this.invalidateMany(sessions);
  }

  // PATCH /api/auth/password — Checks the current password, saves the new hash and signs out every device (raises the token version).
  // Query: user.findUnique, user.update, $transaction
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

  /**
   * "Forgot password": the mailed link already proved who the user is, so no current password.
   * Like changePassword, it signs out every device (new tokenVersion + every session revoked).
   * Opening the link also proves the inbox, so an unverified address becomes verified.
   */
  async resetPassword(
    userId: number,
    newPassword: string,
    verifiedEmail: string,
  ): Promise<void> {
    const password = await bcrypt.hash(newPassword, 12);
    const sessions = await this.database(() =>
      this.prisma.$transaction(async (tx) => {
        await this.lockUser(tx, userId);
        const user = await tx.user.findUnique({ where: { id: userId } });
        if (!user) throw new NotFoundException('User not found');
        await tx.user.update({
          where: { id: userId },
          data: {
            password,
            tokenVersion: { increment: 1 },
            ...(user.emailVerifiedAt === null &&
            user.email.toLowerCase() === verifiedEmail.toLowerCase()
              ? { emailVerifiedAt: new Date() }
              : {}),
          },
        });
        return this.revokeUser(tx, userId);
      }),
    );
    await this.invalidateMany(sessions);
  }

  // PATCH /api/auth/users/:id/ban — Admin bans or unbans a user; a ban also signs them out everywhere.
  // Query: user.findUnique, user.update, $transaction
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
      // Never turn a 4xx (client error or known Prisma conflict/not-found) into a 503.
      if (
        error instanceof HttpException ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          (error.code === 'P2002' ||
            error.code === 'P2025' ||
            error.code === 'P2003'))
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        {
          statusCode: 503,
          code: 'AUTH_UNAVAILABLE',
          message: 'Authentication storage is unavailable',
        },
        { cause: error },
      );
    }
  }
}

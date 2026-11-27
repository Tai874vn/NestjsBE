/**
 * Dedicated Redis client service for the auth module. It caches sessions and refresh tokens, tracks revoked access tokens, broadcasts session revocations over pub/sub, and enforces auth rate limits.
 *
 * Calls: ConfigService; Redis
 * Used by:
 *   - src/modules/auth/session/auth-rate-limit.guard.ts
 *   - src/modules/auth/session/auth-session-redis.module.ts
 *   - src/modules/auth/session/auth-session.service.ts
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'node:fs';
import { createClient } from 'redis';

export type CachedSession = { userId: number; revoked: boolean };
export type AuthCachedRefresh = {
  id: string;
  sessionId: string;
  familyId: string;
  userId: number;
  tokenHash: string;
  expiresAt: string;
  usedAt?: string | null;
  revokedAt?: string | null;
};

type Client = ReturnType<typeof createClient>;
type Connection = {
  client?: Client;
  connecting?: Promise<Client | undefined>;
  retryAt: number;
};

const CHANNEL = 'auth:session:revoked';
const ACCESS_REVOKED_PREFIX = 'auth:access:revoked:';
const BREAKER_MS = 1000;

const WRITE_SESSION = `
local current = redis.call('GET', KEYS[1])
if current then
  local ok, session = pcall(cjson.decode, current)
  if ok and type(session) == 'table' and session.revoked == true then return 0 end
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return 1
`;

const REGISTER_ACCESS = `
local now = tonumber(ARGV[3])
local expiry = tonumber(ARGV[2])
if expiry <= now then return 0 end
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', now)
local current = redis.call('GET', KEYS[1])
if current then
  local ok, session = pcall(cjson.decode, current)
  if ok and type(session) == 'table' and session.revoked == true then
    redis.call('SET', KEYS[3], '1', 'PX', expiry - now)
    return 1
  end
end
redis.call('ZADD', KEYS[2], expiry, ARGV[1])
local latest = redis.call('ZREVRANGE', KEYS[2], 0, 0, 'WITHSCORES')
redis.call('PEXPIRE', KEYS[2], tonumber(latest[2]) - now)
return 1
`;

const REVOKE_SESSION = `
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
local now = tonumber(ARGV[3])
local live = redis.call('ZRANGEBYSCORE', KEYS[2], '(' .. ARGV[3], '+inf', 'WITHSCORES')
for i = 1, #live, 2 do
  redis.call('SET', ARGV[4] .. live[i], '1', 'PX', tonumber(live[i + 1]) - now)
end
redis.call('DEL', KEYS[2])
return 1
`;

const RATE_LIMIT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 or redis.call('PTTL', KEYS[1]) < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
if count <= tonumber(ARGV[1]) then return 1 else return 0 end
`;

@Injectable()
export class AuthRedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuthRedisService.name);
  private lastWarningAt = 0;
  private readonly command: Connection = { retryAt: 0 };
  private readonly subscriber: Connection = { retryAt: 0 };
  private readonly listeners = new Set<(sid: string) => void>();
  private readonly pending = new Map<NodeJS.Timeout, () => void>();
  private readonly url: string | undefined;
  private readonly commandTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private subscriberRetry?: NodeJS.Timeout;
  private stopped = false;

  constructor(private readonly config: ConfigService) {
    this.url = config.get<string>('AUTH_REDIS_URL');
    this.commandTimeoutMs = this.timeout(
      'AUTH_REDIS_COMMAND_TIMEOUT_MS',
      200,
      2000,
    );
    this.connectTimeoutMs = this.timeout(
      'AUTH_REDIS_CONNECT_TIMEOUT_MS',
      1000,
      5000,
    );
  }

  async onModuleInit(): Promise<void> {
    if (!this.url)
      this.logger.warn(
        'AUTH_REDIS_URL is not configured; access revocation checks are degraded',
      );
    await Promise.all([
      this.connect(this.command),
      this.connect(this.subscriber),
    ]);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    clearTimeout(this.subscriberRetry);
    this.subscriberRetry = undefined;
    this.listeners.clear();
    for (const cancel of this.pending.values()) cancel();
    this.pending.clear();
    for (const connection of [this.command, this.subscriber]) {
      const client = connection.client;
      connection.client = undefined;
      if (client) this.destroy(client);
    }
  }

  async readSession(sid: string): Promise<CachedSession | null | undefined> {
    if (!this.validId(sid)) return null;
    const value = await this.run((client) => client.get(`auth:session:${sid}`));
    if (value === undefined || value === null) return value;
    const session = this.parse(value);
    return this.isSession(session) ? session : null;
  }

  async writeSession(
    sid: string,
    userId: number,
    expiresAt: Date,
  ): Promise<boolean> {
    if (!this.validId(sid) || !this.validUserId(userId)) return false;
    return (
      (await this.run((client) => {
        const ttl = this.ttl(expiresAt.getTime());
        return ttl
          ? client.eval(WRITE_SESSION, {
              keys: [`auth:session:${sid}`],
              arguments: [
                JSON.stringify({ userId, revoked: false }),
                String(ttl),
              ],
            })
          : Promise.resolve(0);
      })) === 1
    );
  }

  async revokeSession(
    sid: string,
    userId: number,
    expiresAt: Date,
  ): Promise<boolean> {
    if (!this.validId(sid) || !this.validUserId(userId)) return false;
    return (
      (await this.run((client) => {
        const now = Date.now();
        const ttl = this.ttl(expiresAt.getTime(), now);
        return ttl
          ? client.eval(REVOKE_SESSION, {
              keys: [`auth:session:${sid}`, `auth:session:${sid}:access`],
              arguments: [
                JSON.stringify({ userId, revoked: true }),
                String(ttl),
                String(now),
                ACCESS_REVOKED_PREFIX,
              ],
            })
          : Promise.resolve(0);
      })) === 1
    );
  }

  async readRefresh(
    tokenId: string,
  ): Promise<AuthCachedRefresh | null | undefined> {
    if (!this.validId(tokenId)) return null;
    const value = await this.run((client) =>
      client.get(`auth:refresh:${tokenId}`),
    );
    if (value === undefined || value === null) return value;
    const refresh = this.parse(value);
    return this.isRefresh(refresh) &&
      refresh.id === tokenId &&
      this.ttl(Date.parse(refresh.expiresAt))
      ? refresh
      : null;
  }

  async writeRefresh(value: AuthCachedRefresh): Promise<boolean> {
    if (!this.isRefresh(value)) return false;
    return (
      (await this.run((client) => {
        const ttl = this.ttl(Date.parse(value.expiresAt));
        return ttl
          ? client.set(`auth:refresh:${value.id}`, JSON.stringify(value), {
              PX: ttl,
            })
          : Promise.resolve(null);
      })) === 'OK'
    );
  }

  async registerAccess(
    sid: string,
    jti: string,
    expiresAt: Date,
  ): Promise<boolean> {
    if (!this.validId(sid) || !this.validId(jti)) return false;
    return (
      (await this.run((client) => {
        const now = Date.now();
        const expiry = expiresAt.getTime();
        return this.ttl(expiry, now)
          ? client.eval(REGISTER_ACCESS, {
              keys: [
                `auth:session:${sid}`,
                `auth:session:${sid}:access`,
                `${ACCESS_REVOKED_PREFIX}${jti}`,
              ],
              arguments: [jti, String(expiry), String(now)],
            })
          : Promise.resolve(0);
      })) === 1
    );
  }

  async isAccessRevoked(jti: string): Promise<boolean | undefined> {
    if (!this.validId(jti)) return undefined;
    const value = await this.run((client) =>
      client.get(`${ACCESS_REVOKED_PREFIX}${jti}`),
    );
    return value === undefined ? undefined : value !== null;
  }

  async publishRevocation(sid: string): Promise<boolean> {
    if (this.stopped || !this.validId(sid)) return false;
    this.emitRevocation(sid);
    return (
      (await this.run((client) => client.publish(CHANNEL, sid))) !== undefined
    );
  }

  onRevocation(listener: (sid: string) => void): () => void {
    if (!this.stopped) this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async takeRateLimit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<boolean | undefined> {
    if (
      !key ||
      key.length > 512 ||
      !Number.isSafeInteger(limit) ||
      limit <= 0 ||
      !Number.isSafeInteger(windowMs) ||
      windowMs <= 0
    )
      return undefined;
    const result = await this.run((client) =>
      client.eval(RATE_LIMIT, {
        keys: [`auth:rate:${key}`],
        arguments: [String(limit), String(windowMs)],
      }),
    );
    return result === undefined ? undefined : result === 1;
  }

  private async run<T>(
    operation: (client: Client) => Promise<T>,
  ): Promise<T | undefined> {
    const client = await this.connect(this.command);
    if (!client || this.stopped) return undefined;
    try {
      return await this.deadline(operation(client), this.commandTimeoutMs);
    } catch {
      this.fail(this.command, client);
      return undefined;
    }
  }

  private async connect(connection: Connection): Promise<Client | undefined> {
    if (this.stopped || !this.url || Date.now() < connection.retryAt)
      return undefined;
    if (connection.connecting) return connection.connecting;
    if (connection.client?.isReady) return connection.client;
    connection.connecting = this.open(connection).finally(() => {
      connection.connecting = undefined;
    });
    return connection.connecting;
  }

  private async open(connection: Connection): Promise<Client | undefined> {
    let client: Client | undefined;
    try {
      const passwordFile = this.config.get<string>('AUTH_REDIS_PASSWORD_FILE');
      const password = passwordFile
        ? readFileSync(passwordFile, 'utf8').replace(/[\r\n]+$/, '')
        : this.config.get<string>('AUTH_REDIS_PASSWORD');
      if (passwordFile && !password)
        throw new Error('Empty auth Redis password file');
      let url = this.url;
      let username: string | undefined;
      if (password !== undefined && url) {
        // Redis 5 otherwise lets URL credentials override the password option.
        const parsed = new URL(url);
        username = parsed.username
          ? decodeURIComponent(parsed.username)
          : undefined;
        parsed.username = '';
        parsed.password = '';
        url = parsed.toString();
      }
      client = createClient({
        url,
        ...(username ? { username } : {}),
        ...(password !== undefined ? { password } : {}),
        disableOfflineQueue: true,
        commandsQueueMaxLength: 128,
        socket: {
          connectTimeout: this.connectTimeoutMs,
          reconnectStrategy: false,
        },
      });
      connection.client = client;
      const current = client;
      client.on('error', () => this.fail(connection, current));
      client.on('end', () => this.fail(connection, current));
      await this.deadline(client.connect(), this.connectTimeoutMs);
      if (this.stopped || connection.client !== client) return undefined;
      if (connection === this.subscriber) {
        await this.deadline(
          client.subscribe(CHANNEL, (sid) => {
            if (connection.client === current) this.emitRevocation(sid);
          }),
          this.commandTimeoutMs,
        );
      }
      return !this.stopped && connection.client === client ? client : undefined;
    } catch {
      this.fail(connection, client);
      return undefined;
    }
  }

  private fail(connection: Connection, client?: Client): void {
    if (this.stopped || (client && connection.client !== client)) return;
    if (Date.now() - this.lastWarningAt > 30_000) {
      this.lastWarningAt = Date.now();
      this.logger.warn(
        'Authentication Redis unavailable; access revocation may fail open and refresh uses PostgreSQL',
      );
    }
    connection.client = undefined;
    connection.retryAt = Date.now() + BREAKER_MS;
    if (client) this.destroy(client);
    if (connection === this.subscriber && !this.subscriberRetry) {
      this.subscriberRetry = setTimeout(() => {
        this.subscriberRetry = undefined;
        void this.connect(this.subscriber);
      }, BREAKER_MS);
      this.subscriberRetry.unref();
    }
  }

  private destroy(client: Client): void {
    try {
      client.destroy();
    } catch {
      /* Redis may already have closed the socket. */
    }
  }

  private deadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_resolve, reject) => {
      const cancel = () => {
        clearTimeout(timer);
        reject(new Error('Auth Redis deadline exceeded'));
      };
      timer = setTimeout(cancel, timeoutMs);
      this.pending.set(timer, cancel);
    });
    return Promise.race([operation, timeout]).finally(() => {
      clearTimeout(timer);
      this.pending.delete(timer);
    });
  }

  private emitRevocation(sid: string): void {
    if (this.stopped || !this.validId(sid)) return;
    for (const listener of this.listeners) {
      try {
        const result: unknown = listener(sid);
        if (result instanceof Promise) {
          void result.catch((error: unknown) => {
            this.logger.warn(
              `Session revocation listener failed for session ${sid}: ${error instanceof Error ? error.message : String(error)}`,
            );
          });
        }
      } catch (error) {
        // A failed socket disconnect must not stop other listeners, but still log it once.
        this.logger.warn(
          `Session revocation listener failed for session ${sid}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private timeout(key: string, fallback: number, maximum: number): number {
    const value = Number(this.config.get<string | number>(key));
    return Number.isSafeInteger(value) && value > 0
      ? Math.min(value, maximum)
      : fallback;
  }

  private ttl(expiry: number, now = Date.now()): number | undefined {
    const ttl = expiry - now;
    return Number.isSafeInteger(ttl) && ttl > 0 ? ttl : undefined;
  }

  private validId(value: string): boolean {
    return typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
  }

  private validUserId(value: unknown): value is number {
    return (
      typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    );
  }

  private parse(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  private isSession(value: unknown): value is CachedSession {
    if (!value || typeof value !== 'object') return false;
    const session = value as Record<string, unknown>;
    return (
      this.validUserId(session.userId) && typeof session.revoked === 'boolean'
    );
  }

  private isRefresh(value: unknown): value is AuthCachedRefresh {
    if (!value || typeof value !== 'object') return false;
    const refresh = value as AuthCachedRefresh;
    return (
      this.validId(refresh.id) &&
      this.validId(refresh.sessionId) &&
      this.validId(refresh.familyId) &&
      this.validUserId(refresh.userId) &&
      typeof refresh.tokenHash === 'string' &&
      /^[a-f\d]{64}$/i.test(refresh.tokenHash) &&
      typeof refresh.expiresAt === 'string' &&
      Number.isFinite(Date.parse(refresh.expiresAt)) &&
      [refresh.usedAt, refresh.revokedAt].every(
        (value) =>
          value == null ||
          (typeof value === 'string' && Number.isFinite(Date.parse(value))),
      )
    );
  }
}

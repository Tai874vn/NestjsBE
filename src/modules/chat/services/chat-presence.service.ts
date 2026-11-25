import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { createClient } from 'redis';
import { REDIS_CLIENT } from '../../redis/redis.module';

const ONLINE_KEY_PREFIX = 'chat:online:';
const ONLINE_TTL = 60 * 60;

@Injectable()
export class ChatPresenceService {
  private readonly logger = new Logger('ChatPresenceService');
  private readonly onlineUsers = new Map<number, Set<string>>();
  private readonly redisClient: ReturnType<typeof createClient> | null;
  private redisErrorLogged = false;

  constructor(
    @Optional()
    @Inject(REDIS_CLIENT)
    injectedRedisClient: ReturnType<typeof createClient> | null,
  ) {
    this.redisClient = injectedRedisClient;
  }

  logMode() {
    if (this.redisClient) {
      this.logger.log('Redis client available for online user tracking');
    } else {
      this.logger.log('No Redis client - using in-memory online tracking');
    }
  }

  async addOnlineUser(userId: number, socketId: string): Promise<void> {
    if (this.redisClient) {
      try {
        const key = `${ONLINE_KEY_PREFIX}${userId}`;
        await this.redisClient.sAdd(key, socketId);
        await this.redisClient.expire(key, ONLINE_TTL);
        this.redisErrorLogged = false;
        return;
      } catch (error) {
        this.warnOnce('addOnlineUser', error);
      }
    }

    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set());
    }
    this.onlineUsers.get(userId)!.add(socketId);
  }

  async refreshOnlineUser(userId: number): Promise<void> {
    if (!this.redisClient) return;

    try {
      await this.redisClient.expire(
        `${ONLINE_KEY_PREFIX}${userId}`,
        ONLINE_TTL,
      );
      this.redisErrorLogged = false;
    } catch (error) {
      this.warnOnce('refreshOnlineUser', error);
    }
  }

  async removeOnlineUser(userId: number, socketId: string): Promise<number> {
    if (this.redisClient) {
      try {
        const key = `${ONLINE_KEY_PREFIX}${userId}`;
        await this.redisClient.sRem(key, socketId);
        const remaining = await this.redisClient.sCard(key);
        if (remaining === 0) {
          await this.redisClient.del(key);
        }
        this.redisErrorLogged = false;
        return remaining;
      } catch (error) {
        this.warnOnce('removeOnlineUser', error);
      }
    }

    const sockets = this.onlineUsers.get(userId);
    if (!sockets) {
      return 0;
    }
    sockets.delete(socketId);
    if (sockets.size === 0) {
      this.onlineUsers.delete(userId);
      return 0;
    }
    return sockets.size;
  }

  async getOnlineSockets(userId: number): Promise<string[]> {
    if (this.redisClient) {
      try {
        const key = `${ONLINE_KEY_PREFIX}${userId}`;
        const members = await this.redisClient.sMembers(key);
        this.redisErrorLogged = false;
        return members;
      } catch (error) {
        this.warnOnce('getOnlineSockets', error);
      }
    }

    const sockets = this.onlineUsers.get(userId);
    return sockets ? Array.from(sockets) : [];
  }

  async getOnlineUserIds(userIds: number[]): Promise<number[]> {
    if (userIds.length === 0) {
      return [];
    }

    if (this.redisClient) {
      try {
        const pipeline = this.redisClient.multi();
        for (const userId of userIds) {
          pipeline.sCard(`${ONLINE_KEY_PREFIX}${userId}`);
        }
        const counts = await pipeline.exec();
        this.redisErrorLogged = false;
        return userIds.filter((_, index) => Number(counts[index]) > 0);
      } catch (error) {
        this.warnOnce('getOnlineUserIds', error);
      }
    }

    return userIds.filter((userId) => this.onlineUsers.has(userId));
  }

  private warnOnce(operation: string, error: unknown): void {
    if (this.redisErrorLogged) return;
    this.redisErrorLogged = true;
    const reason = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      `Chat presence Redis ${operation} failed (${reason}). Falling back to in-memory tracking.`,
    );
  }
}

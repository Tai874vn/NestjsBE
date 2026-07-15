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
      const key = `${ONLINE_KEY_PREFIX}${userId}`;
      await this.redisClient.sAdd(key, socketId);
      await this.redisClient.expire(key, ONLINE_TTL);
      return;
    }

    if (!this.onlineUsers.has(userId)) {
      this.onlineUsers.set(userId, new Set());
    }
    this.onlineUsers.get(userId)!.add(socketId);
  }

  async removeOnlineUser(userId: number, socketId: string): Promise<number> {
    if (this.redisClient) {
      const key = `${ONLINE_KEY_PREFIX}${userId}`;
      await this.redisClient.sRem(key, socketId);
      const remaining = await this.redisClient.sCard(key);
      if (remaining === 0) {
        await this.redisClient.del(key);
      }
      return remaining;
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
      const key = `${ONLINE_KEY_PREFIX}${userId}`;
      return this.redisClient.sMembers(key);
    }

    const sockets = this.onlineUsers.get(userId);
    return sockets ? Array.from(sockets) : [];
  }

  async getOnlineUserIds(userIds: number[]): Promise<number[]> {
    if (!this.redisClient) {
      return userIds.filter((userId) => this.onlineUsers.has(userId));
    }
    if (userIds.length === 0) {
      return [];
    }

    const pipeline = this.redisClient.multi();
    for (const userId of userIds) {
      pipeline.sCard(`${ONLINE_KEY_PREFIX}${userId}`);
    }
    const counts = await pipeline.exec();
    return userIds.filter((_, index) => Number(counts[index]) > 0);
  }
}

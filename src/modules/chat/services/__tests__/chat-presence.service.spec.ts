import { Logger } from '@nestjs/common';
import { ChatPresenceService } from '../chat-presence.service';

describe('ChatPresenceService Redis error guarding', () => {
  it('catches Redis failures, logs once, and falls back to in-memory tracking', async () => {
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const fail = () => Promise.reject(new Error('Redis unavailable'));
    const redisClient = {
      sAdd: jest.fn().mockImplementation(fail),
      expire: jest.fn().mockImplementation(fail),
      sRem: jest.fn().mockImplementation(fail),
      sCard: jest.fn().mockImplementation(fail),
      del: jest.fn().mockImplementation(fail),
      sMembers: jest.fn().mockImplementation(fail),
      multi: jest.fn(() => ({
        sCard: jest.fn().mockReturnThis(),
        exec: jest.fn().mockImplementation(fail),
      })),
    };
    const service = new ChatPresenceService(redisClient as never);

    await expect(service.addOnlineUser(10, 'sock-1')).resolves.toBeUndefined();
    await expect(service.refreshOnlineUser(10)).resolves.toBeUndefined();
    await expect(service.getOnlineSockets(10)).resolves.toEqual(['sock-1']);
    await expect(service.getOnlineUserIds([10, 11])).resolves.toEqual([10]);
    await expect(service.removeOnlineUser(10, 'sock-1')).resolves.toBe(0);
    await expect(service.getOnlineSockets(10)).resolves.toEqual([]);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

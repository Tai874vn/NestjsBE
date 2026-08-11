import { ChatSocketRateLimitService } from './chat-socket-rate-limit.service';

describe('ChatSocketRateLimitService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-18T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('blocks requests after the event limit is reached', async () => {
    const service = new ChatSocketRateLimitService(null);

    await expect(service.consume(6, 'send-message', 2, 60_000)).resolves.toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
    await expect(service.consume(6, 'send-message', 2, 60_000)).resolves.toEqual({
      allowed: true,
      retryAfterMs: 0,
    });

    const blocked = await service.consume(6, 'send-message', 2, 60_000);

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('resets the bucket after the window expires', async () => {
    const service = new ChatSocketRateLimitService(null);

    await service.consume(6, 'typing', 1, 10_000);
    await expect(service.consume(6, 'typing', 1, 10_000)).resolves.toMatchObject({
      allowed: false,
    });

    jest.advanceTimersByTime(10_000);

    await expect(service.consume(6, 'typing', 1, 10_000)).resolves.toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
  });

  it('uses Redis atomic counters when a Redis client is available', async () => {
    const redis = {
      incr: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(3),
      pExpire: jest.fn().mockResolvedValue(undefined),
      pTTL: jest.fn().mockResolvedValue(12_000),
    };
    const service = new ChatSocketRateLimitService(redis as never);

    await expect(service.consume(6, 'send-message', 2, 60_000)).resolves.toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
    await expect(service.consume(6, 'send-message', 2, 60_000)).resolves.toEqual({
      allowed: false,
      retryAfterMs: 12_000,
    });

    expect(redis.incr).toHaveBeenCalledWith('chat:socket-rate:6:send-message');
    expect(redis.pExpire).toHaveBeenCalledWith('chat:socket-rate:6:send-message', 60_000);
    expect(redis.pTTL).toHaveBeenCalledWith('chat:socket-rate:6:send-message');
  });
});

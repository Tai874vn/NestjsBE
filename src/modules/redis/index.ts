/**
 * Redis module barrel file that re-exports RedisModule and RedisService.
 *
 * Calls: RedisModule; RedisService
 * Used by:
 *   - no file imports it (only tests, or not used)
 */

export * from './redis.module';
export * from './services/redis.service';

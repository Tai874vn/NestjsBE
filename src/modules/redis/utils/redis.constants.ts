/**
 * Dependency injection token for the Redis module. Exports REDIS_CLIENT so other modules and services can inject the shared Redis client.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/main.ts
 *   - src/modules/redis/redis.module.ts
 *   - src/modules/redis/services/redis.service.ts
 */

export const REDIS_CLIENT = 'REDIS_CLIENT';

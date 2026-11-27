/**
 * Redis module admin controller for clearing cache groups and viewing cache key prefixes.
 * Routes: DELETE /api/cache/all -> clearAllCaches(), DELETE /api/cache/jobs -> clearJobCaches(), DELETE /api/cache/users -> clearUserCaches(), DELETE /api/cache/categories -> clearCategoryCaches(), DELETE /api/cache/jobs/:id -> clearJobCache(), DELETE /api/cache/users/:id -> clearUserCache(), GET /api/cache/keys -> getCacheKeys().
 *
 * Calls: RedisService; CACHE_KEYS; JwtAuthGuard; RolesGuard; Roles; Role
 * Used by:
 *   - src/modules/redis/redis.module.ts
 */

import { Controller, Delete, Param, UseGuards, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles';
import { RedisService, CACHE_KEYS } from '../services/redis.service';

@ApiTags('Cache')
@Controller('cache')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class RedisController {
  constructor(private readonly redisService: RedisService) {}

  @Delete('all')
  @ApiOperation({ summary: 'Clear all caches (Admin only)' })
  async clearAllCaches() {
    await this.redisService.reset();
    return {
      message: 'All caches cleared successfully',
    };
  }

  @Delete('jobs')
  @ApiOperation({ summary: 'Clear job-related caches' })
  async clearJobCaches() {
    await this.redisService.invalidateJobCaches();
    return {
      message: 'Job caches cleared successfully',
    };
  }

  @Delete('users')
  @ApiOperation({ summary: 'Clear user-related caches' })
  async clearUserCaches() {
    await this.redisService.invalidateUserCaches();
    return {
      message: 'User caches cleared successfully',
    };
  }

  @Delete('categories')
  @ApiOperation({ summary: 'Clear category-related caches' })
  async clearCategoryCaches() {
    await this.redisService.invalidateCategoryCaches();
    return {
      message: 'Category caches cleared successfully',
    };
  }

  @Delete('jobs/:id')
  @ApiOperation({ summary: 'Clear cache for a specific job' })
  async clearJobCache(@Param('id') id: string) {
    await this.redisService.invalidateJobCaches(parseInt(id, 10));
    return {
      message: `Cache for job ${id} cleared successfully`,
    };
  }

  @Delete('users/:id')
  @ApiOperation({ summary: 'Clear cache for a specific user' })
  async clearUserCache(@Param('id') id: string) {
    await this.redisService.invalidateUserCaches(parseInt(id, 10));
    return {
      message: `Cache for user ${id} cleared successfully`,
    };
  }

  @Get('keys')
  @ApiOperation({ summary: 'Get list of cache key prefixes' })
  getCacheKeys() {
    return {
      message: 'Cache key prefixes',
      content: CACHE_KEYS,
    };
  }
}

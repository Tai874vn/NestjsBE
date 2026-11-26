import 'reflect-metadata';
import { HEADERS_METADATA } from '@nestjs/common/constants';
import type { Request, Response } from 'express';
import { IS_PUBLIC_KEY } from '../../decorators/public.decorator';
import { CategoriesController } from '../../../modules/categories/controllers/categories.controller';
import { OccupationsController } from '../../../modules/occupations/controllers/occupations.controller';
import { SkillController } from '../../../modules/skill/controllers/skill.controller';
import {
  applyApiCacheControl,
  CacheControlMiddleware,
  DEFAULT_API_CACHE_CONTROL,
  PUBLIC_TAXONOMY_CACHE_CONTROL,
} from '../cache-control.middleware';

function createMockResponse(initialHeaders: Record<string, string> = {}) {
  const headers = new Map<string, string>(
    Object.entries(initialHeaders).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const res = {
    getHeader: jest.fn((name: string) => headers.get(name.toLowerCase())),
    setHeader: jest.fn((name: string, value: string) => {
      headers.set(name.toLowerCase(), value);
      return res;
    }),
  };
  return { res: res as unknown as Response, headers };
}

describe('Cache-Control middleware', () => {
  it('sets private, no-store on /api/* responses by default', () => {
    const { res, headers } = createMockResponse();
    const next = jest.fn();

    applyApiCacheControl({ originalUrl: '/api/auth/me' } as Request, res, next);

    expect(headers.get('cache-control')).toBe(DEFAULT_API_CACHE_CONTROL);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('preserves a Cache-Control header already set on the response', () => {
    const { res, headers } = createMockResponse({
      'Cache-Control': PUBLIC_TAXONOMY_CACHE_CONTROL,
    });
    const next = jest.fn();

    new CacheControlMiddleware().use(
      { originalUrl: '/api/categories' } as Request,
      res,
      next,
    );

    expect(headers.get('cache-control')).toBe(PUBLIC_TAXONOMY_CACHE_CONTROL);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('allows a route handler to override the default Cache-Control header', () => {
    const { res, headers } = createMockResponse();
    const next = jest.fn(() => {
      res.setHeader('Cache-Control', PUBLIC_TAXONOMY_CACHE_CONTROL);
    });

    applyApiCacheControl(
      { originalUrl: '/api/occupations?q=dev' } as Request,
      res,
      next,
    );

    expect(headers.get('cache-control')).toBe(PUBLIC_TAXONOMY_CACHE_CONTROL);
  });

  it('does not touch non-/api/* paths', () => {
    const { res, headers } = createMockResponse();
    const next = jest.fn();

    applyApiCacheControl(
      { originalUrl: '/uploads/images/avatar.webp' } as Request,
      res,
      next,
    );

    expect(headers.has('cache-control')).toBe(false);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('marks only truly anonymous public taxonomy endpoints with public, max-age=300', () => {
    const cacheHeaderOf = (controller: object, method: string) => {
      const handler = (controller as Record<string, object>)[method];
      const headers =
        (Reflect.getMetadata(HEADERS_METADATA, handler) as Array<{
          name: string;
          value: string;
        }>) ?? [];
      return headers.find((h) => h.name.toLowerCase() === 'cache-control')
        ?.value;
    };

    const publicTaxonomyHandlers: Array<[object, string]> = [
      [CategoriesController.prototype, 'findAll'],
      [CategoriesController.prototype, 'findAllWithPagination'],
      [CategoriesController.prototype, 'findOne'],
      [OccupationsController.prototype, 'search'],
      [OccupationsController.prototype, 'findOne'],
      [SkillController.prototype, 'findAll'],
      [SkillController.prototype, 'search'],
      [SkillController.prototype, 'fieldsOfStudy'],
    ];

    for (const [proto, method] of publicTaxonomyHandlers) {
      const handler = (proto as Record<string, object>)[method];
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(cacheHeaderOf(proto, method)).toBe(PUBLIC_TAXONOMY_CACHE_CONTROL);
    }

    // Authenticated or write endpoints must never carry a public Cache-Control header.
    const privateOrWriteHandlers: Array<[object, string]> = [
      [CategoriesController.prototype, 'create'],
      [CategoriesController.prototype, 'update'],
      [CategoriesController.prototype, 'remove'],
      [SkillController.prototype, 'extract'],
    ];

    for (const [proto, method] of privateOrWriteHandlers) {
      expect(cacheHeaderOf(proto, method)).toBeUndefined();
    }
  });
});

import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService, CACHE_KEYS, CACHE_TTL } from '../../redis/redis.service';
import {
  AiRecommendationClient,
  AiSkillSummary,
} from '../../recommendations/services/ai-recommendation.client';

const SKILL_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SKILL_SEARCH_MAX_CACHED_QUERY_LENGTH = 40;

/**
 * Skills come from the AI service's dictionary (ESCO and O*NET), the same one the seniority model is trained
 * with. Users pick from it; free-typed names are resolved to it or rejected.
 */
@Injectable()
export class SkillService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
    private aiClient: AiRecommendationClient,
  ) {}

  /** Skills already used on profiles, for filters such as the candidate directory. */
  async findAll() {
    return this.redisService.getOrSet(
      CACHE_KEYS.SKILL_LIST,
      async () => {
        const profileSkills = await this.prisma.userSkill.findMany({
          distinct: ['name'],
          select: { name: true },
          orderBy: { name: 'asc' },
        });
        return {
          message: 'Get skills successfully',
          content: profileSkills.map((skill) => skill.name),
        };
      },
      CACHE_TTL.LONG,
    );
  }

  async search(query: string, field?: string, limit = 10) {
    const normalizedQuery = query.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!normalizedQuery) {
      return { message: 'Search skills successfully', content: [] };
    }

    const normalizedField = field?.trim().toLowerCase() ?? '';
    const load = async () => ({
      message: 'Search skills successfully',
      content: await this.aiClient.searchSkills(
        normalizedQuery,
        normalizedField || undefined,
        limit,
      ),
    });

    // Skip caching long free-text queries so arbitrary input cannot fill up cache memory.
    if (normalizedQuery.length > SKILL_SEARCH_MAX_CACHED_QUERY_LENGTH) {
      return load();
    }

    const cacheKey = `${CACHE_KEYS.SKILL_LIST}:search:${normalizedField}:${limit}:${normalizedQuery}`;
    return this.redisService.getOrSet(
      cacheKey,
      load,
      SKILL_SEARCH_CACHE_TTL_MS,
    );
  }

  /** Skills named in CV text. These are suggestions for the user to confirm, never saved directly. */
  async extract(text: string) {
    return {
      message: 'Skills found in text',
      content: await this.aiClient.extractSkills(text),
    };
  }

  async fieldsOfStudy() {
    return this.redisService.getOrSet(
      `${CACHE_KEYS.SKILL_LIST}:fields-of-study`,
      async () => ({
        message: 'Get fields of study successfully',
        content: await this.aiClient.fieldsOfStudy(),
      }),
      CACHE_TTL.LONG,
    );
  }

  /**
   * The dictionary skill for each name, in order. Any known spelling works ("reactjs" gives React).
   * Throws when a name is not in the dictionary, listing every unknown name.
   */
  async requireKnownSkills(names: string[]): Promise<AiSkillSummary[]> {
    if (names.length === 0) {
      return [];
    }
    const resolved = await this.aiClient.resolveSkills(names);
    const unknown = names.filter((_, index) => !resolved[index]);
    if (unknown.length) {
      throw new BadRequestException(
        `Choose skills from the list. Not recognised: ${unknown.join(', ')}`,
      );
    }
    return resolved as AiSkillSummary[];
  }
}

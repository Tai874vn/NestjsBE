import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService, CACHE_KEYS, CACHE_TTL } from '../../redis/redis.service';

@Injectable()
export class SkillService {
  constructor(
    private prisma: PrismaService,
    private redisService: RedisService,
  ) {}

  async findAll() {
    return this.redisService.getOrSet(
      CACHE_KEYS.SKILL_LIST,
      async () => {
        const users = await this.prisma.nguoiDung.findMany({
          select: {
            id: true,
            name: true,
            skill: true,
          },
          where: {
            skill: {
              not: null,
            },
          },
        });

        const skills = users
          .filter((user) => user.skill)
          .flatMap((user) => {
            try {
              const parsedSkills = JSON.parse(user.skill || '[]');
              return Array.isArray(parsedSkills) ? parsedSkills : [];
            } catch {
              return [];
            }
          })
          .filter((skill, index, self) => self.indexOf(skill) === index);

        return {
          message: 'Get skills successfully',
          content: skills,
        };
      },
      CACHE_TTL.LONG, // 1 hour - skills don't change often
    );
  }
}

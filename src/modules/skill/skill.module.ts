/**
 * NestJS module for the skill feature. Imports RecommendationsModule, registers SkillController and SkillService, and exports SkillService.
 *
 * Calls: RecommendationsModule; SkillController; SkillService
 * Used by:
 *   - src/app.module.ts
 *   - src/modules/users/users.module.ts
 */

import { Module } from '@nestjs/common';
import { SkillService } from './services/skill.service';
import { SkillController } from './controllers/skill.controller';
import { RecommendationsModule } from '../recommendations/recommendations.module';

@Module({
  imports: [RecommendationsModule],
  controllers: [SkillController],
  providers: [SkillService],
  exports: [SkillService],
})
export class SkillModule {}

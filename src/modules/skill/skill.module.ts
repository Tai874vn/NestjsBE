import { Module } from '@nestjs/common';
import { SkillService } from './services/skill.service';
import { SkillController } from './controllers/skill.controller';
import { PrismaService } from '../../prisma.service';

@Module({
  controllers: [SkillController],
  providers: [SkillService, PrismaService],
  exports: [SkillService],
})
export class SkillModule {}

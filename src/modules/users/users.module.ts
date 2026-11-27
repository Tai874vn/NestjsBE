/**
 * NestJS module for the users feature.
 * Registers UsersController and the user, profile, portfolio, resume, upload, and candidate directory services, and exports UsersService.
 *
 * Calls: RecommendationsModule; AuthModule; SkillModule; UsersController; UsersService; UserProfileService; UserResumeService; CandidateDirectoryService
 * Used by:
 *   - src/app.module.ts
 */

import { Module } from '@nestjs/common';
import { UsersService } from './services/users.service';
import { CandidateDirectoryService } from './services/candidate-directory.service';
import { ProfileCompletionService } from './services/profile-completion.service';
import { UserLegacyProfileSyncService } from './services/user-legacy-profile-sync.service';
import { UserPortfolioService } from './services/user-portfolio.service';
import { UserProfileService } from './services/user-profile.service';
import { UserProfileNormalizerService } from './services/user-profile-normalizer.service';
import { UserResumeService } from './services/user-resume.service';
import { ResumeAiQueueService } from './services/resume-ai-queue.service';
import { UserUploadsService } from './services/user-uploads.service';
import { UsersController } from './controllers/users.controller';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { AuthModule } from '../auth/auth.module';
import { SkillModule } from '../skill/skill.module';

@Module({
  imports: [RecommendationsModule, AuthModule, SkillModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    CandidateDirectoryService,
    ProfileCompletionService,
    UserLegacyProfileSyncService,
    UserPortfolioService,
    UserProfileService,
    UserProfileNormalizerService,
    UserResumeService,
    ResumeAiQueueService,
    UserUploadsService,
  ],
  exports: [UsersService],
})
export class UsersModule {}

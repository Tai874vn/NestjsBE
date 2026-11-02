import { Module } from '@nestjs/common';
import { UsersService } from './services/users.service';
import { CandidateDirectoryService } from './services/candidate-directory.service';
import { ProfileCompletionService } from './services/profile-completion.service';
import { UserLegacyProfileSyncService } from './services/user-legacy-profile-sync.service';
import { UserPortfolioService } from './services/user-portfolio.service';
import { UserProfileService } from './services/user-profile.service';
import { UserProfileNormalizerService } from './services/user-profile-normalizer.service';
import { UserResumeService } from './services/user-resume.service';
import { UserUploadsService } from './services/user-uploads.service';
import { UsersController } from './controllers/users.controller';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';
import { RecommendationsModule } from '../recommendations/recommendations.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [CloudinaryModule, RecommendationsModule, AuthModule],
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
    UserUploadsService,
  ],
  exports: [UsersService],
})
export class UsersModule {}

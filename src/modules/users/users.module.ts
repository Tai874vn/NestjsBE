import { Module } from '@nestjs/common';
import { UsersService } from './services/users.service';
import { CandidateDirectoryService } from './services/candidate-directory.service';
import { ProfileCompletionService } from './services/profile-completion.service';
import { UserLegacyProfileSyncService } from './services/user-legacy-profile-sync.service';
import { UserProfileNormalizerService } from './services/user-profile-normalizer.service';
import { UserUploadsService } from './services/user-uploads.service';
import { UsersController } from './controllers/users.controller';
import { PrismaService } from '../../prisma.service';
import { CloudinaryModule } from '../cloudinary/cloudinary.module';

@Module({
  imports: [CloudinaryModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    CandidateDirectoryService,
    ProfileCompletionService,
    UserLegacyProfileSyncService,
    UserProfileNormalizerService,
    UserUploadsService,
    PrismaService,
  ],
  exports: [UsersService],
})
export class UsersModule {}

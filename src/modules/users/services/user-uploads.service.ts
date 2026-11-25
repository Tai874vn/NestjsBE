import { BadRequestException, Injectable } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { UserProfileService } from './user-profile.service';
import { UserResumeService } from './user-resume.service';

@Injectable()
export class UserUploadsService {
  constructor(
    private readonly storageService: StorageService,
    private readonly userProfileService: UserProfileService,
    private readonly userResumeService: UserResumeService,
  ) {}

  async uploadResumeFile(userId: number, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Resume file is required');
    }

    const previousKey =
      await this.userResumeService.getResumeFilePublicId(userId);
    const result = await this.storageService.uploadDocument(file, 'resumes');
    try {
      const response = await this.userResumeService.uploadResumeFile(userId, {
        originalName: file.originalname,
        mimeType: result.mimeType,
        size: result.size,
        url: result.key,
        publicId: result.key,
      });
      if (previousKey && previousKey !== result.key) {
        await this.storageService.deleteDocument(previousKey);
      }
      return response;
    } catch (error) {
      await this.storageService.deleteDocument(result.key);
      throw error;
    }
  }

  async uploadAvatar(userId: number, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }

    const previous = await this.userProfileService.getUploadReferences(userId);
    const previousKey = previous.avatar
      ? this.storageService.extractKey(previous.avatar)
      : null;
    const result = await this.storageService.uploadImage(file, 'avatars');
    try {
      const response = await this.userProfileService.uploadAvatar(
        userId,
        result.url,
      );
      if (previousKey && previousKey !== result.key) {
        await this.storageService.deleteImage(previousKey);
      }
      return response;
    } catch (error) {
      await this.storageService.deleteImage(result.key);
      throw error;
    }
  }

  async uploadCover(userId: number, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Cover image file is required');
    }

    const previous = await this.userProfileService.getUploadReferences(userId);
    const previousKey = previous.coverImage
      ? this.storageService.extractKey(previous.coverImage)
      : null;
    const result = await this.storageService.uploadImage(file, 'covers');
    try {
      const response = await this.userProfileService.uploadCover(
        userId,
        result.url,
      );
      if (previousKey && previousKey !== result.key) {
        await this.storageService.deleteImage(previousKey);
      }
      return response;
    } catch (error) {
      await this.storageService.deleteImage(result.key);
      throw error;
    }
  }
}

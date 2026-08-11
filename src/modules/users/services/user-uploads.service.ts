import { BadRequestException, Injectable } from '@nestjs/common';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { UserProfileService } from './user-profile.service';
import { UserResumeService } from './user-resume.service';

@Injectable()
export class UserUploadsService {
  constructor(
    private readonly cloudinaryService: CloudinaryService,
    private readonly userProfileService: UserProfileService,
    private readonly userResumeService: UserResumeService,
  ) {}

  async uploadResumeFile(userId: number, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Resume file is required');
    }

    const result = await this.cloudinaryService.uploadDocument(file, 'resumes');
    try {
      return await this.userResumeService.uploadResumeFile(userId, {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url: result.secure_url,
        publicId: result.public_id,
      });
    } catch (error) {
      await this.cloudinaryService.deleteDocument(result.public_id);
      throw error;
    }
  }

  async uploadAvatar(userId: number, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }

    const result = await this.cloudinaryService.uploadImage(file, 'avatars');
    try {
      return await this.userProfileService.uploadAvatar(
        userId,
        result.secure_url,
      );
    } catch (error) {
      await this.cloudinaryService.deleteImage(result.public_id);
      throw error;
    }
  }

  async uploadCover(userId: number, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Cover image file is required');
    }

    const result = await this.cloudinaryService.uploadImage(file, 'covers');
    try {
      return await this.userProfileService.uploadCover(
        userId,
        result.secure_url,
      );
    } catch (error) {
      await this.cloudinaryService.deleteImage(result.public_id);
      throw error;
    }
  }
}

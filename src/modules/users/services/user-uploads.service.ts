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

    const previousPublicId =
      await this.userResumeService.getResumeFilePublicId(userId);
    const result = await this.cloudinaryService.uploadDocument(file, 'resumes');
    try {
      const response = await this.userResumeService.uploadResumeFile(userId, {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        url: result.secure_url,
        publicId: result.public_id,
      });
      if (previousPublicId && previousPublicId !== result.public_id) {
        await this.cloudinaryService.deleteDocument(previousPublicId);
      }
      return response;
    } catch (error) {
      await this.cloudinaryService.deleteDocument(result.public_id);
      throw error;
    }
  }

  async uploadAvatar(userId: number, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }

    const previous = await this.userProfileService.getUploadReferences(userId);
    const previousPublicId = previous.avatar
      ? this.cloudinaryService.extractPublicId(previous.avatar)
      : null;
    const result = await this.cloudinaryService.uploadImage(file, 'avatars');
    try {
      const response = await this.userProfileService.uploadAvatar(
        userId,
        result.secure_url,
      );
      if (previousPublicId && previousPublicId !== result.public_id) {
        await this.cloudinaryService.deleteImage(previousPublicId);
      }
      return response;
    } catch (error) {
      await this.cloudinaryService.deleteImage(result.public_id);
      throw error;
    }
  }

  async uploadCover(userId: number, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Cover image file is required');
    }

    const previous = await this.userProfileService.getUploadReferences(userId);
    const previousPublicId = previous.coverImage
      ? this.cloudinaryService.extractPublicId(previous.coverImage)
      : null;
    const result = await this.cloudinaryService.uploadImage(file, 'covers');
    try {
      const response = await this.userProfileService.uploadCover(
        userId,
        result.secure_url,
      );
      if (previousPublicId && previousPublicId !== result.public_id) {
        await this.cloudinaryService.deleteImage(previousPublicId);
      }
      return response;
    } catch (error) {
      await this.cloudinaryService.deleteImage(result.public_id);
      throw error;
    }
  }
}

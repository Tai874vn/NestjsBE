import { BadRequestException, Injectable } from '@nestjs/common';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import { UsersService } from './users.service';

@Injectable()
export class UserUploadsService {
  constructor(
    private readonly cloudinaryService: CloudinaryService,
    private readonly usersService: UsersService,
  ) {}

  async uploadResumeFile(userId: number, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Resume file is required');
    }

    const result = await this.cloudinaryService.uploadDocument(file, 'resumes');
    return this.usersService.uploadResumeFile(userId, {
      originalName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      url: result.secure_url,
      publicId: result.public_id,
    });
  }

  async uploadAvatar(userId: number, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Avatar file is required');
    }

    const result = await this.cloudinaryService.uploadImage(file, 'avatars');
    return this.usersService.uploadAvatar(userId, result.secure_url);
  }

  async uploadCover(userId: number, file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('Cover image file is required');
    }

    const result = await this.cloudinaryService.uploadImage(file, 'covers');
    return this.usersService.uploadCover(userId, result.secure_url);
  }
}

import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService } from '../../redis/redis.service';
import { StorageService } from '../../storage/storage.service';
import { UpsertPortfolioItemDto } from '../dto/profile.dto';
import { ProfileCompletionService } from './profile-completion.service';

@Injectable()
export class UserPortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly profileCompletionService: ProfileCompletionService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  async createPortfolioItem(userId: number, dto: UpsertPortfolioItemDto) {
    await this.ensureUserExists(userId);

    const item = await this.prisma.userPortfolioItem.create({
      data: {
        userId,
        title: dto.title.trim(),
        description: dto.description?.trim(),
        image: dto.image?.trim(),
        url: dto.url?.trim(),
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    await this.profileCompletionService.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Portfolio item created successfully',
      content: item,
    };
  }

  async updatePortfolioItem(
    userId: number,
    itemId: number,
    dto: UpsertPortfolioItemDto,
  ) {
    const existing = await this.ensurePortfolioOwnership(userId, itemId);

    const item = await this.prisma.userPortfolioItem.update({
      where: { id: itemId },
      data: {
        title: dto.title.trim(),
        description: dto.description?.trim(),
        image: dto.image?.trim(),
        url: dto.url?.trim(),
        sortOrder: dto.sortOrder ?? 0,
      },
    });

    // Clean up an old local image if it was replaced or cleared.
    if (
      dto.image !== undefined &&
      existing.image &&
      existing.image !== item.image
    ) {
      await this.storage?.deleteImage(existing.image);
    }

    await this.profileCompletionService.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Portfolio item updated successfully',
      content: item,
    };
  }

  async deletePortfolioItem(userId: number, itemId: number) {
    const existing = await this.ensurePortfolioOwnership(userId, itemId);

    await this.prisma.userPortfolioItem.delete({
      where: { id: itemId },
    });

    if (existing.image) {
      await this.storage?.deleteImage(existing.image);
    }

    await this.profileCompletionService.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Portfolio item deleted successfully',
    };
  }

  private async ensureUserExists(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }
  }

  private async ensurePortfolioOwnership(userId: number, itemId: number) {
    const item = await this.prisma.userPortfolioItem.findUnique({
      where: { id: itemId },
      select: { userId: true, image: true },
    });

    if (!item) {
      throw new NotFoundException(`Portfolio item with ID ${itemId} not found`);
    }

    if (item.userId !== userId) {
      throw new ForbiddenException('You can only update your own portfolio');
    }

    return item;
  }
}

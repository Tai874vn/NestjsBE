import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { RedisService } from '../../redis/redis.service';
import { UpsertPortfolioItemDto } from '../dto/profile.dto';
import { ProfileCompletionService } from './profile-completion.service';

@Injectable()
export class UserPortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly profileCompletionService: ProfileCompletionService,
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
    await this.ensurePortfolioOwnership(userId, itemId);

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

    await this.profileCompletionService.updateProfileCompletion(userId);
    await this.redisService.invalidateUserCaches(userId);

    return {
      message: 'Portfolio item updated successfully',
      content: item,
    };
  }

  async deletePortfolioItem(userId: number, itemId: number) {
    await this.ensurePortfolioOwnership(userId, itemId);

    await this.prisma.userPortfolioItem.delete({
      where: { id: itemId },
    });

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
      select: { userId: true },
    });

    if (!item) {
      throw new NotFoundException(`Portfolio item with ID ${itemId} not found`);
    }

    if (item.userId !== userId) {
      throw new ForbiddenException('You can only update your own portfolio');
    }
  }
}

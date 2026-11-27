/**
 * Profile completion service for the users module.
 * Checks if a user has a name, avatar, headline, bio, and at least one skill, then saves the profileCompleted flag.
 *
 * Calls: prisma.user
 * Used by:
 *   - src/modules/users/services/user-portfolio.service.ts
 *   - src/modules/users/services/user-profile.service.ts
 *   - src/modules/users/users.module.ts
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';

@Injectable()
export class ProfileCompletionService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfileCompletion(userId: number): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        avatar: true,
        headline: true,
        bio: true,
        profileSkills: {
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!user) {
      return false;
    }

    const profileCompleted = Boolean(
      user.name &&
      user.avatar &&
      user.headline &&
      user.bio &&
      user.profileSkills.length > 0,
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { profileCompleted },
    });

    return profileCompleted;
  }
}

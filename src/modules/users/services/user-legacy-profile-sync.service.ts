/**
 * Legacy profile sync service for the users module.
 * Copies a user's skill and certification rows back into the old JSON string columns on the user record.
 *
 * Calls: prisma.userSkill; prisma.userCertification; prisma.user
 * Used by:
 *   - src/modules/users/services/user-profile.service.ts
 *   - src/modules/users/users.module.ts
 */

import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';

@Injectable()
export class UserLegacyProfileSyncService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(userId: number): Promise<void> {
    const [skills, certifications] = await Promise.all([
      this.prisma.userSkill.findMany({
        where: { userId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { name: true },
      }),
      this.prisma.userCertification.findMany({
        where: { userId },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { name: true },
      }),
    ]);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        skill: JSON.stringify(skills.map((skill) => skill.name)),
        certification: JSON.stringify(
          certifications.map((certification) => certification.name),
        ),
      },
    });
  }
}

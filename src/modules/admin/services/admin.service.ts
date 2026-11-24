import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async getStats() {
    const [users, jobs, contracts, comments] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.job.count(),
      this.prisma.contract.count(),
      this.prisma.comment.count(),
    ]);

    return {
      message: 'Admin statistics fetched successfully',
      content: { users, jobs, contracts, comments },
    };
  }
}

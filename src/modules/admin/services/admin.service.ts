import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  // GET /api/admin/stats — Counts shown on the admin dashboard.
  // Query: user.count, job.count, contract.count, comment.count
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

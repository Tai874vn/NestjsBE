/**
 * Core user management service for the users module.
 * Handles admin user CRUD, paginated and name searches, email-change requests, and user deletion with file cleanup.
 *
 * Calls: prisma.user; RedisService; AuthSessionService; EmailVerificationService; StorageService; bcrypt
 * Used by:
 *   - src/modules/users/controllers/users.controller.ts
 *   - src/modules/users/users.module.ts
 */

import {
  Injectable,
  NotFoundException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma.service';
import { RedisService } from '../../redis/services/redis.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Role } from '../../../common/constants/roles';
import { AuthSessionService } from '../../auth/session/auth-session.service';
import { StorageService } from '../../storage/services/storage.service';
import { EmailVerificationService } from '../../auth/services/email-verification.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly sessions: AuthSessionService,
    private readonly emailVerification: EmailVerificationService,
    @Optional() private readonly storage?: StorageService,
  ) {}

  // POST /api/users — Admin creates a user.
  // Query: user.create
  async create(createUserDto: CreateUserDto) {
    const email = this.normalizeEmail(createUserDto.email);
    const existingUser = await this.findUserByEmail(email);

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        ...createUserDto,
        email,
        password: hashedPassword,
        role: createUserDto.role || Role.USER,
        candidateDiscoverable: true,
        // Only an admin can create users here, so the address counts as checked.
        emailVerifiedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        birthDay: true,
        gender: true,
        role: true,
        skill: true,
        certification: true,
        headline: true,
        bio: true,
        location: true,
        website: true,
        avatar: true,
        coverImage: true,
        profileCompleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Invalidate user list caches
    await this.redisService.invalidateUserCaches();

    return {
      message: 'User created successfully',
      content: user,
    };
  }

  // GET /api/users — Admin table: every user.
  // Query: user.findMany
  async findAll() {
    const users = await this.prisma.user.findMany({
      take: 100,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        birthDay: true,
        gender: true,
        role: true,
        skill: true,
        certification: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: 'desc' },
    });

    return {
      message: 'Get users successfully',
      content: users,
    };
  }

  // GET /api/users/paginated-search — Users by page with keyword search (candidate directory too).
  // Query: user.findMany, user.count
  async findAllWithPagination(paginationDto: PaginationDto) {
    const { page = 1, pageSize = 10, keyword } = paginationDto;
    const skip = (page - 1) * pageSize;

    const where = keyword
      ? {
          OR: [
            { name: { contains: keyword, mode: 'insensitive' as const } },
            { email: { contains: keyword, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        skip,
        take: pageSize,
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          birthDay: true,
          gender: true,
          role: true,
          skill: true,
          certification: true,
          headline: true,
          bio: true,
          location: true,
          website: true,
          avatar: true,
          coverImage: true,
          profileCompleted: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      message: 'Get users with pagination successfully',
      content: {
        data: users,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  // GET /api/users/:id — One user by id.
  // Query: user.findUnique
  async findOne(id: number) {
    // Query PostgreSQL directly by primary key instead of caching private PII in Redis.
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        birthDay: true,
        gender: true,
        role: true,
        skill: true,
        certification: true,
        headline: true,
        bio: true,
        location: true,
        website: true,
        avatar: true,
        coverImage: true,
        profileCompleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return {
      message: 'Get user successfully',
      content: user,
    };
  }

  // GET /api/users/search/:name — Users whose name matches.
  // Query: user.findMany
  async searchByName(name: string) {
    const users = await this.prisma.user.findMany({
      where: {
        name: {
          contains: name,
          mode: 'insensitive' as const,
        },
      },
      take: 20,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        birthDay: true,
        gender: true,
        role: true,
        skill: true,
        certification: true,
        headline: true,
        bio: true,
        location: true,
        website: true,
        avatar: true,
        coverImage: true,
        profileCompleted: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { id: 'desc' },
    });

    return {
      message: 'Search users successfully',
      content: users,
    };
  }

  // PUT /api/users/:id — Admin edits a user.
  // Query: user.findUnique, user.update
  async update(id: number, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    const email = updateUserDto.email
      ? this.normalizeEmail(updateUserDto.email)
      : undefined;

    if (email && email !== user.email.toLowerCase()) {
      const existingUser = await this.findUserByEmail(email);

      if (existingUser) {
        throw new ConflictException('Email already exists');
      }
    }

    const updatedUser = await this.prisma.user.update({
      where: { id },
      data: {
        ...updateUserDto,
        ...(email ? { email } : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        birthDay: true,
        gender: true,
        role: true,
        skill: true,
        certification: true,
        headline: true,
        bio: true,
        location: true,
        website: true,
        avatar: true,
        coverImage: true,
        profileCompleted: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Invalidate user caches
    await this.redisService.invalidateUserCaches(id);

    return {
      message: 'User updated successfully',
      content: updatedUser,
    };
  }

  /**
   * The user's own new address: nothing changes until the link mailed to it is opened
   * (EmailVerificationService.verify). The same address again does nothing.
   */
  async requestOwnEmailChange(id: number, newEmail: string) {
    const email = this.normalizeEmail(newEmail);
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { email: true },
    });
    if (!user) throw new NotFoundException(`User with ID ${id} not found`);
    if (user.email.toLowerCase() === email) return { pendingEmail: null };
    return this.emailVerification.requestEmailChange(id, email);
  }

  // DELETE /api/users/:id — Admin deletes a user and signs them out.
  // Query: user.findUnique; delete: auth-session.service.ts deleteUser()
  async remove(id: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        resume: { select: { sourceFilePublicId: true, sourceFileUrl: true } },
        posts: { select: { imagePublicId: true, imageUrl: true } },
        jobs: { select: { image: true } },
        portfolioItems: { select: { image: true } },
      },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.sessions.deleteUser(id);

    // Delete local files for the user and all cascaded child rows after the DB delete commits.
    if (user.avatar) await this.storage?.deleteImage(user.avatar);
    if (user.coverImage) await this.storage?.deleteImage(user.coverImage);
    const resumeKey =
      user.resume?.sourceFilePublicId ?? user.resume?.sourceFileUrl;
    if (resumeKey) await this.storage?.deleteDocument(resumeKey);
    for (const post of user.posts ?? []) {
      const postImage = post.imagePublicId ?? post.imageUrl;
      if (postImage) await this.storage?.deleteImage(postImage);
    }
    for (const job of user.jobs ?? []) {
      if (job.image) await this.storage?.deleteImage(job.image);
    }
    for (const item of user.portfolioItems ?? []) {
      if (item.image) await this.storage?.deleteImage(item.image);
    }

    // Invalidate user caches
    await this.redisService.invalidateUserCaches(id);

    return {
      message: 'User deleted successfully',
    };
  }

  private findUserByEmail(email: string) {
    const normalizedEmail = this.normalizeEmail(email);
    return this.prisma.user.findFirst({
      where: { email: { equals: normalizedEmail, mode: 'insensitive' } },
      orderBy: { id: 'asc' },
    });
  }

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }
}

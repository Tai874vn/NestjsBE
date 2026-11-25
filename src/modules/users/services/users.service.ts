import {
  Injectable,
  NotFoundException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { Role } from '../../../common/constants/roles';
import { AuthSessionService } from '../../auth/session/auth-session.service';
import { StorageService } from '../../storage/storage.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly sessions: AuthSessionService,
    @Optional() private readonly storage?: StorageService,
  ) {}

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

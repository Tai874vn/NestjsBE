import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../prisma.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { PaginationDto } from '../../../common/dto/pagination.dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    const existingUser = await this.prisma.nguoiDung.findUnique({
      where: { email: createUserDto.email },
    });

    if (existingUser) {
      throw new ConflictException('Email already exists');
    }

    const hashedPassword = await bcrypt.hash(createUserDto.passWord, 10);

    const user = await this.prisma.nguoiDung.create({
      data: {
        ...createUserDto,
        passWord: hashedPassword,
        role: createUserDto.role || 'user',
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
        avatar: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      message: 'User created successfully',
      content: user,
    };
  }

  async findAll() {
    const users = await this.prisma.nguoiDung.findMany({
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
      this.prisma.nguoiDung.findMany({
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
          avatar: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { id: 'desc' },
      }),
      this.prisma.nguoiDung.count({ where }),
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
    const user = await this.prisma.nguoiDung.findUnique({
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
        avatar: true,
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
    const users = await this.prisma.nguoiDung.findMany({
      where: {
        name: {
          contains: name,
          mode: 'insensitive' as const,
        },
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
        avatar: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return {
      message: 'Search users successfully',
      content: users,
    };
  }

  async update(id: number, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.nguoiDung.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const existingUser = await this.prisma.nguoiDung.findUnique({
        where: { email: updateUserDto.email },
      });

      if (existingUser) {
        throw new ConflictException('Email already exists');
      }
    }

    const updatedUser = await this.prisma.nguoiDung.update({
      where: { id },
      data: updateUserDto,
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
    });

    return {
      message: 'User updated successfully',
      content: updatedUser,
    };
  }

  async remove(id: number) {
    const user = await this.prisma.nguoiDung.findUnique({
      where: { id },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    await this.prisma.nguoiDung.delete({
      where: { id },
    });

    return {
      message: 'User deleted successfully',
    };
  }

  async uploadAvatar(userId: number, filename: string) {
    const user = await this.prisma.nguoiDung.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    const updatedUser = await this.prisma.nguoiDung.update({
      where: { id: userId },
      data: { avatar: filename },
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
    });

    return {
      message: 'Avatar uploaded successfully',
      content: updatedUser,
    };
  }
}

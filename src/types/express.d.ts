import type { User as PrismaUser } from '@prisma/client';

declare global {
  namespace Express {
    interface User {
      id: PrismaUser['id'];
      name: PrismaUser['name'];
      email: PrismaUser['email'];
      password: PrismaUser['password'];
      phone: PrismaUser['phone'];
      birthDay: PrismaUser['birthDay'];
      gender: PrismaUser['gender'];
      role: PrismaUser['role'];
      skill: PrismaUser['skill'];
      certification: PrismaUser['certification'];
      headline: PrismaUser['headline'];
      bio: PrismaUser['bio'];
      location: PrismaUser['location'];
      website: PrismaUser['website'];
      googleId: PrismaUser['googleId'];
      avatar: PrismaUser['avatar'];
      coverImage: PrismaUser['coverImage'];
      profileCompleted: PrismaUser['profileCompleted'];
      candidateDiscoverable: PrismaUser['candidateDiscoverable'];
      refreshToken: PrismaUser['refreshToken'];
      createdAt: PrismaUser['createdAt'];
      updatedAt: PrismaUser['updatedAt'];
    }

    interface Request {
      user?: User;
    }
  }
}

export {};

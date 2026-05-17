import { User } from '@prisma/client';

declare global {
  namespace Express {
    interface User {
      id: User['id'];
      name: User['name'];
      email: User['email'];
      password: User['password'];
      phone: User['phone'];
      birthDay: User['birthDay'];
      gender: User['gender'];
      role: User['role'];
      skill: User['skill'];
      certification: User['certification'];
      googleId: User['googleId'];
      avatar: User['avatar'];
      refreshToken: User['refreshToken'];
      createdAt: User['createdAt'];
      updatedAt: User['updatedAt'];
    }

    interface Request {
      user?: User;
    }
  }
}

export {};

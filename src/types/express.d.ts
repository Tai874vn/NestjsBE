import { NguoiDung } from '@prisma/client';

declare global {
  namespace Express {
    interface User {
      id: NguoiDung['id'];
      name: NguoiDung['name'];
      email: NguoiDung['email'];
      password: NguoiDung['password'];
      phone: NguoiDung['phone'];
      birthDay: NguoiDung['birthDay'];
      gender: NguoiDung['gender'];
      role: NguoiDung['role'];
      skill: NguoiDung['skill'];
      certification: NguoiDung['certification'];
      googleId: NguoiDung['googleId'];
      avatar: NguoiDung['avatar'];
      refreshToken: NguoiDung['refreshToken'];
      createdAt: NguoiDung['createdAt'];
      updatedAt: NguoiDung['updatedAt'];
    }

    interface Request {
      user?: User;
    }
  }
}

export {};

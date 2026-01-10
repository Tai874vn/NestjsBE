import { Prisma } from '@prisma/client';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type NguoiDungType = Prisma.NguoiDungGetPayload<{}>;

declare global {
  namespace Express {
    interface User extends NguoiDungType {}
    interface Request {
      user?: User;
    }
  }
}

export {};

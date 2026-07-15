import { Socket } from 'socket.io';

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: {
      id: number;
      name: string;
      avatar: string | null;
    };
  };
}

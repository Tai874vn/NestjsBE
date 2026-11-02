import { Socket } from 'socket.io';

export interface RealtimeSocketClaims {
  sub: number;
  sid: string;
  jti: string;
  type: 'access' | 'socket';
}

export interface AuthenticatedSocket extends Socket {
  data: {
    sessionId?: string;
    jti?: string;
    presenceRegistered?: boolean;
    user?: {
      id: number;
      name: string;
      avatar: string | null;
    };
  };
}

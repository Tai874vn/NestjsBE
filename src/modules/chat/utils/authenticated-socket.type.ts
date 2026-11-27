/**
 * TypeScript interfaces for authenticated WebSocket connections in the chat module.
 * It defines token claim shapes and the user and session fields attached to a Socket.IO socket.
 *
 * Calls: socket.io (Socket)
 * Used by:
 *   - src/modules/chat/gateways/chat.gateway.ts
 *   - src/modules/chat/services/chat-socket-auth.service.ts
 *   - src/modules/notifications/gateways/notifications.gateway.ts
 */

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

/**
 * Service in the auth module that signs short-lived JWT tickets (60 seconds) for opening chat and notification WebSocket connections.
 *
 * Calls: JwtService
 * Used by:
 *   - src/modules/auth/auth.module.ts
 *   - src/modules/auth/controllers/realtime-ticket.controller.ts
 */

import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';

const REALTIME_TICKET_TTL_SECONDS = 60;

@Injectable()
export class RealtimeTicketService {
  constructor(private readonly jwtService: JwtService) {}

  // GET /api/auth/realtime-ticket — Short-lived ticket the browser uses to open the chat/notification socket.
  // Query: none (signed JWT)
  issue(userId: number, sessionId: string, role: string) {
    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      typeof sessionId !== 'string' ||
      !sessionId.trim() ||
      typeof role !== 'string' ||
      !role.trim()
    ) {
      throw new UnauthorizedException('Invalid authenticated session');
    }

    const token = this.jwtService.sign(
      { sub: userId, sid: sessionId, role, jti: randomUUID(), type: 'socket' },
      { expiresIn: `${REALTIME_TICKET_TTL_SECONDS}s` },
    );

    return { token, expiresInSeconds: REALTIME_TICKET_TTL_SECONDS };
  }
}

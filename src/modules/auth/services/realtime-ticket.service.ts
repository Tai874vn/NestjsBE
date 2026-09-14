import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const REALTIME_TICKET_TTL_SECONDS = 60;

@Injectable()
export class RealtimeTicketService {
  constructor(private readonly jwtService: JwtService) {}

  issue(userId: number, email: string) {
    const token = this.jwtService.sign(
      { sub: userId, email, type: 'socket' },
      { expiresIn: `${REALTIME_TICKET_TTL_SECONDS}s` },
    );

    return { token, expiresInSeconds: REALTIME_TICKET_TTL_SECONDS };
  }
}

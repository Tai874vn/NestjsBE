import {
  Controller,
  Get,
  Header,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import * as express from 'express';
import { RealtimeTicketService } from '../services/realtime-ticket.service';

@Controller('auth')
export class RealtimeTicketController {
  constructor(private readonly ticketService: RealtimeTicketService) {}

  @Get('realtime-ticket')
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  issue(@Req() req: express.Request) {
    const user = req.user as
      | (Express.User & { sessionId?: string })
      | undefined;
    if (!user || typeof user.sessionId !== 'string' || !user.sessionId.trim()) {
      throw new UnauthorizedException('User session not authenticated');
    }

    return {
      content: this.ticketService.issue(user.id, user.sessionId, user.role),
    };
  }
}

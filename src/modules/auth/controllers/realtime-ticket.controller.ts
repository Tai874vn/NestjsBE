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
    if (!req.user) throw new UnauthorizedException('User not authenticated');

    return {
      content: this.ticketService.issue(req.user.id, req.user.email),
    };
  }
}

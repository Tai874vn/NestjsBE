/**
 * HTTP controller in the auth module for managing login sessions, passwords, and user bans. Routes: GET /api/auth/sessions -> list(); DELETE /api/auth/sessions/:id -> revoke(); GET /api/auth/users/:id/sessions -> listForUser(); POST /api/auth/logout-all -> logoutAll(); PATCH /api/auth/password -> password(); PATCH /api/auth/users/:id/ban -> ban().
 *
 * Calls: AuthSessionService; clearAuthCookies; Roles; Role; ChangePasswordDto; BanUserDto
 * Used by:
 *   - src/modules/auth/auth.module.ts
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import * as express from 'express';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles';
import { AuthSessionService } from '../session/auth-session.service';
import { BanUserDto, ChangePasswordDto } from '../dto/session.dto';
import { clearAuthCookies } from '../session/auth-cookies';

@Controller('auth')
export class AuthSessionsController {
  constructor(private readonly sessions: AuthSessionService) {}

  @Get('sessions')
  async list(@Req() req: express.Request) {
    return {
      content: await this.sessions.list(req.user!.id),
      currentSessionId: req.user!.sessionId,
    };
  }

  @Delete('sessions/:id')
  async revoke(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: express.Request,
  ) {
    await this.sessions.revoke(
      id,
      req.user!.id,
      (req.user!.role as Role) === Role.ADMIN,
    );
    return { message: 'Session revoked successfully' };
  }

  @Get('users/:id/sessions')
  @Roles(Role.ADMIN)
  async listForUser(@Param('id', ParseIntPipe) id: number) {
    return { content: await this.sessions.list(id) };
  }

  @Post('logout-all')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async logoutAll(
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.sessions.logoutAll(req.user!.id);
    clearAuthCookies(res);
    return { message: 'All sessions revoked successfully' };
  }

  @Patch('password')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async password(
    @Body() dto: ChangePasswordDto,
    @Req() req: express.Request,
    @Res({ passthrough: true }) res: express.Response,
  ) {
    await this.sessions.changePassword(
      req.user!.id,
      dto.currentPassword,
      dto.newPassword,
    );
    clearAuthCookies(res);
    return { message: 'Password changed; sign in again' };
  }

  @Patch('users/:id/ban')
  @Roles(Role.ADMIN)
  async ban(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BanUserDto,
    @Req() req: express.Request,
  ) {
    await this.sessions.setBanned(id, dto.banned, req.user!.id);
    return {
      message: dto.banned
        ? 'User banned; all sessions revoked'
        : 'User unbanned; previous sessions remain revoked',
    };
  }
}

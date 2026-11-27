/**
 * HTTP controller for viewing and acting on hiring applications in the hiring-pipeline module.
 * Routes: GET /api/applications/:id -> findOne(), POST /api/applications/:id/shortlist -> shortlist(), POST /api/applications/:id/reject -> reject(), POST /api/applications/:id/offer -> sendOffer(), POST /api/applications/:id/offer/withdraw -> withdrawOffer(), POST /api/applications/:id/offer/accept -> acceptOffer(), POST /api/applications/:id/offer/decline -> declineOffer(), POST /api/applications/:id/withdraw -> withdraw().
 *
 * Calls: ApplicationsService; JwtAuthGuard; RolesGuard
 * Used by:
 *   - src/modules/hiring-pipeline/hiring-pipeline.module.ts
 */

import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/constants/roles';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { ValidatedUser } from '../../../types';
import { ApplicationsService } from '../services/applications.service';
import { ApplicationActionDto } from '../dto/application-action.dto';

/**
 * One hiring application: its detail page and the pipeline actions on it.
 * Every action answers { message, content: ApplicationDetail }.
 * The role guard (@Roles) only lets the right kind of account in; the service then checks that the
 * user is this post's owner (or an admin), or this application's applicant.
 */
@Controller('applications')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  // Any signed-in user; the service allows the post owner, an admin, or the applicant.
  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.applications.findOne(id, user);
  }

  @Post(':id/shortlist')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  shortlist(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.applications.shortlist(id, user);
  }

  @Post(':id/reject')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplicationActionDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.applications.reject(id, user, dto.note);
  }

  @Post(':id/offer')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  sendOffer(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplicationActionDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.applications.sendOffer(id, user, dto.note);
  }

  @Post(':id/offer/withdraw')
  @Roles(Role.EMPLOYER, Role.ADMIN)
  withdrawOffer(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.applications.withdrawOffer(id, user);
  }

  @Post(':id/offer/accept')
  @Roles(Role.USER, Role.ADMIN)
  acceptOffer(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.applications.acceptOffer(id, user);
  }

  @Post(':id/offer/decline')
  @Roles(Role.USER, Role.ADMIN)
  declineOffer(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplicationActionDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.applications.declineOffer(id, user, dto.note);
  }

  @Post(':id/withdraw')
  @Roles(Role.USER, Role.ADMIN)
  withdraw(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.applications.withdraw(id, user);
  }
}

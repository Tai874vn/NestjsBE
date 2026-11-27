/**
 * HTTP controller for milestone actions in the contracts module.
 * Routes: POST /api/milestones/:id/fund -> fund(), POST /api/milestones/:id/submit -> submit(), POST /api/milestones/:id/request-changes -> requestChanges(), POST /api/milestones/:id/approve -> approve().
 *
 * Calls: ContractsService; JwtAuthGuard
 * Used by:
 *   - src/modules/contracts/contracts.module.ts
 */

import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ValidatedUser } from '../../../types';
import { ContractsService } from '../services/contracts.service';
import { RequestChangesDto, SubmitWorkDto } from '../dto/milestone.dto';

/**
 * Milestone steps. The service finds the contract, locks it and checks the side:
 * fund, request changes and approve are the client's; submit is the freelancer's.
 * Every action answers { message, content: ContractDetail }.
 */
@Controller('milestones')
@UseGuards(JwtAuthGuard)
export class MilestonesController {
  constructor(private readonly contracts: ContractsService) {}

  @Post(':id/fund')
  fund(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.contracts.fund(id, user);
  }

  @Post(':id/submit')
  submit(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SubmitWorkDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.contracts.submit(id, user, dto);
  }

  @Post(':id/request-changes')
  requestChanges(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RequestChangesDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.contracts.requestChanges(id, user, dto.note);
  }

  @Post(':id/approve')
  approve(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.contracts.approve(id, user);
  }
}

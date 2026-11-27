/**
 * HTTP controller for reading and ending contracts in the contracts module.
 * Routes: GET /api/contracts -> list(); GET /api/contracts/:id -> findOne(); POST /api/contracts/:id/end -> end(); POST /api/contracts/:id/end-requests -> requestEnd(); POST /api/contracts/:id/end-requests/accept -> acceptEnd(); POST /api/contracts/:id/end-requests/decline -> declineEnd(); POST /api/contracts/:id/end-requests/withdraw -> withdrawEnd().
 *
 * Calls: ContractsService; ContractsQueryService; AmendmentsService; JwtAuthGuard
 * Used by:
 *   - src/modules/contracts/contracts.module.ts
 */

import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { ValidatedUser } from '../../../types';
import { AmendmentsService } from '../services/amendments.service';
import { ContractsQueryService } from '../services/contracts-query.service';
import { ContractsService } from '../services/contracts.service';
import { AcceptEndRequestDto, CreateEndRequestDto } from '../dto/amendment.dto';
import { ContractListQueryDto } from '../dto/milestone.dto';

/**
 * Contracts (any role). Reading: the list and the detail page. The client may end a contract
 * alone while no credits are held. Every action answers { message, content: ContractDetail }.
 */
@Controller('contracts')
@UseGuards(JwtAuthGuard)
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly query: ContractsQueryService,
    private readonly amendments: AmendmentsService,
  ) {}

  // role=client: contracts where I pay; role=freelancer: contracts where I work.
  @Get()
  list(
    @Query() query: ContractListQueryDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.query.list(user, query);
  }

  // Either side (an admin may read too); anyone else 403.
  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.query.findOne(id, user);
  }

  // Client only, and only while nothing is held: the contract becomes ENDED (CLIENT_ENDED).
  @Post(':id/end')
  end(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.contracts.end(id, user);
  }

  // Either side: ask to end together. The client must pick approve or refund when work is submitted.
  @Post(':id/end-requests')
  requestEnd(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateEndRequestDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.amendments.requestEnd(id, user, dto);
  }

  // The other side: agree. The contract ends (MUTUAL).
  @Post(':id/end-requests/accept')
  acceptEnd(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AcceptEndRequestDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.amendments.acceptEnd(id, user, dto);
  }

  // The other side: say no.
  @Post(':id/end-requests/decline')
  declineEnd(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.amendments.declineEnd(id, user);
  }

  // The person who asked.
  @Post(':id/end-requests/withdraw')
  withdrawEnd(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.amendments.withdrawEnd(id, user);
  }
}

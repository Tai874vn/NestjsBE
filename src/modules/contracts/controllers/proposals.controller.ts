/**
 * HTTP controller for service proposals in the contracts module.
 * Routes: POST /api/proposals -> create(), GET /api/proposals -> list(), GET /api/proposals/:id -> findOne(), POST /api/proposals/:id/counter -> counter(), POST /api/proposals/:id/accept -> accept(), POST /api/proposals/:id/decline -> decline(), POST /api/proposals/:id/withdraw -> withdraw().
 *
 * Calls: ProposalsService; JwtAuthGuard
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
import {
  AcceptProposalDto,
  CreateProposalDto,
  DeclineProposalDto,
  ProposalListQueryDto,
  VersionBodyDto,
} from '../dto/proposal.dto';
import { ProposalsService } from '../services/proposals.service';

/**
 * Proposals on services (any role). Every action answers { message, content: ProposalDetail }.
 * The service checks that the user is the client or the freelancer of the proposal, and whose
 * turn it is.
 */
@Controller('proposals')
@UseGuards(JwtAuthGuard)
export class ProposalsController {
  constructor(private readonly proposals: ProposalsService) {}

  // Client: a new proposal on someone else's service.
  @Post()
  create(@Body() dto: CreateProposalDto, @CurrentUser() user: ValidatedUser) {
    return this.proposals.create(user, dto);
  }

  // role=client: the ones I sent; role=freelancer: the ones on my services. Newest change first.
  @Get()
  list(
    @Query() query: ProposalListQueryDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.proposals.list(user, query);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.proposals.findOne(id, user);
  }

  @Post(':id/counter')
  counter(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VersionBodyDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.proposals.counter(id, user, dto);
  }

  // The body names the version the user read; a newer one gives 409.
  @Post(':id/accept')
  accept(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AcceptProposalDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.proposals.accept(id, user, dto.version);
  }

  @Post(':id/decline')
  decline(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeclineProposalDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.proposals.decline(id, user, dto.note);
  }

  @Post(':id/withdraw')
  withdraw(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.proposals.withdraw(id, user);
  }
}

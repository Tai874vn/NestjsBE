/**
 * HTTP controller for mid-contract amendments in the contracts module.
 * Routes: POST /api/contracts/:id/amendments -> propose(); POST /api/amendments/:id/accept -> accept(); POST /api/amendments/:id/decline -> decline(); POST /api/amendments/:id/withdraw -> withdraw().
 *
 * Calls: AmendmentsService; JwtAuthGuard
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
import { AmendmentsService } from '../services/amendments.service';
import { CreateAmendmentDto, DeclineAmendmentDto } from '../dto/amendment.dto';

/**
 * Amendments (changes in the middle of a contract). The service finds the contract, locks it and
 * checks the side. Every action answers { message, content: ContractDetail }.
 */
@Controller()
@UseGuards(JwtAuthGuard)
export class AmendmentsController {
  constructor(private readonly amendments: AmendmentsService) {}

  // Either side: ask for a change.
  @Post('contracts/:id/amendments')
  propose(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAmendmentDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.amendments.propose(id, user, dto);
  }

  // The other side.
  @Post('amendments/:id/accept')
  accept(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.amendments.accept(id, user);
  }

  // The other side.
  @Post('amendments/:id/decline')
  decline(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeclineAmendmentDto,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.amendments.decline(id, user, dto.note);
  }

  // The person who asked.
  @Post('amendments/:id/withdraw')
  withdraw(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: ValidatedUser,
  ) {
    return this.amendments.withdraw(id, user);
  }
}

import {
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
import { ContractsQueryService } from '../contracts-query.service';
import { ContractsService } from '../contracts.service';
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
}

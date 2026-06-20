import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ValidatedUser } from '../../../types';
import { ConnectionsQueryDto } from '../dto/connections-query.dto';
import { ConnectionsService } from '../services/connections.service';

@Controller('connections')
@UseGuards(JwtAuthGuard)
export class ConnectionsController {
  constructor(private readonly connectionsService: ConnectionsService) {}

  @Get()
  getConnections(
    @CurrentUser() user: ValidatedUser,
    @Query() query: ConnectionsQueryDto,
  ) {
    return this.connectionsService.getConnections(user.id, query);
  }

  @Get('requests')
  getRequests(@CurrentUser() user: ValidatedUser) {
    return this.connectionsService.getRequests(user.id);
  }

  @Get('suggestions')
  getSuggestions(
    @CurrentUser() user: ValidatedUser,
    @Query() query: ConnectionsQueryDto,
  ) {
    return this.connectionsService.getSuggestions(user.id, query);
  }

  @Get('status/:userId')
  getStatus(
    @CurrentUser() user: ValidatedUser,
    @Param('userId', ParseIntPipe) targetUserId: number,
  ) {
    return this.connectionsService.getStatus(user.id, targetUserId);
  }

  @Post('requests/:userId')
  sendRequest(
    @CurrentUser() user: ValidatedUser,
    @Param('userId', ParseIntPipe) recipientId: number,
  ) {
    return this.connectionsService.sendRequest(user.id, recipientId);
  }

  @Put('requests/:id/accept')
  acceptRequest(
    @CurrentUser() user: ValidatedUser,
    @Param('id', ParseIntPipe) connectionId: number,
  ) {
    return this.connectionsService.acceptRequest(connectionId, user.id);
  }

  @Delete(':id')
  deleteConnection(
    @CurrentUser() user: ValidatedUser,
    @Param('id', ParseIntPipe) connectionId: number,
  ) {
    return this.connectionsService.deleteConnection(connectionId, user.id);
  }
}

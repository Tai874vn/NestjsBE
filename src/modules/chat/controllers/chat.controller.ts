import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ChatService } from '../services/chat.service';
import { CreateRoomDto } from '../dto/chat.dto';

@ApiTags('Chat')
@Controller('api/chat')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('rooms')
  @ApiOperation({ summary: 'Create a new chat room' })
  async createRoom(
    @Body() createRoomDto: CreateRoomDto,
    @CurrentUser() user: { id: number },
  ) {
    const room = await this.chatService.createRoom(user.id, createRoomDto);
    return {
      message: 'Room created successfully',
      content: room,
    };
  }

  @Get('rooms')
  @ApiOperation({ summary: 'Get all chat rooms for the current user' })
  async getUserRooms(@CurrentUser() user: { id: number }) {
    const rooms = await this.chatService.getUserRooms(user.id);
    return {
      message: 'Rooms fetched successfully',
      content: rooms,
    };
  }

  @Get('rooms/:id')
  @ApiOperation({ summary: 'Get a specific chat room' })
  async getRoom(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    const room = await this.chatService.getRoom(id, user.id);
    return {
      message: 'Room fetched successfully',
      content: room,
    };
  }

  @Get('rooms/:id/messages')
  @ApiOperation({ summary: 'Get messages from a chat room' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'offset', required: false, type: Number })
  async getRoomMessages(
    @Param('id', ParseIntPipe) id: number,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @CurrentUser() user?: { id: number },
  ) {
    const messages = await this.chatService.getMessages(user!.id, {
      roomId: id,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    return {
      message: 'Messages fetched successfully',
      content: messages,
    };
  }

  @Post('rooms/:id/leave')
  @ApiOperation({ summary: 'Leave a chat room' })
  async leaveRoom(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: { id: number },
  ) {
    await this.chatService.leaveRoom(id, user.id);
    return {
      message: 'Left room successfully',
    };
  }

  @Get('start/:userId')
  @ApiOperation({ summary: 'Start or get private chat with a user' })
  async startPrivateChat(
    @Param('userId', ParseIntPipe) otherUserId: number,
    @CurrentUser() user: { id: number },
  ) {
    // Try to find existing private room
    const existingRoom = await this.chatService.findPrivateRoom(
      user.id,
      otherUserId,
    );

    if (existingRoom) {
      return {
        message: 'Private chat found',
        content: {
          id: existingRoom.id,
          name: existingRoom.name,
          isPrivate: existingRoom.isPrivate,
          members: existingRoom.members.map((m) => ({
            id: m.user.id,
            name: m.user.name,
            avatar: m.user.avatar,
          })),
          createdAt: existingRoom.createdAt,
        },
      };
    }

    // Create new private room
    const room = await this.chatService.createRoom(user.id, {
      memberIds: [otherUserId],
      isPrivate: true,
    });

    return {
      message: 'Private chat created',
      content: room,
    };
  }
}

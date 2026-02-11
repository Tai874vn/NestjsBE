import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsArray,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateRoomDto {
  @ApiPropertyOptional({ description: 'Room name (optional for private chats)' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ description: 'Array of user IDs to add to the room' })
  @IsArray()
  @IsInt({ each: true })
  memberIds: number[];

  @ApiPropertyOptional({ description: 'Whether the room is private', default: true })
  @IsOptional()
  @IsBoolean()
  isPrivate?: boolean;
}

export class SendMessageDto {
  @ApiProperty({ description: 'Room ID' })
  @IsInt()
  @Min(1)
  roomId: number;

  @ApiProperty({ description: 'Message content' })
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  content: string;
}

export class JoinRoomDto {
  @ApiProperty({ description: 'Room ID to join' })
  @IsInt()
  @Min(1)
  roomId: number;
}

export class LeaveRoomDto {
  @ApiProperty({ description: 'Room ID to leave' })
  @IsInt()
  roomId: number;
}

export class GetMessagesDto {
  @ApiProperty({ description: 'Room ID' })
  @IsInt()
  @Min(1)
  roomId: number;

  @ApiPropertyOptional({ description: 'Number of messages to fetch', default: 50 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Load messages before this message ID (cursor)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  before?: number;
}

export class TypingDto {
  @ApiProperty({ description: 'Room ID' })
  @IsInt()
  roomId: number;

  @ApiProperty({ description: 'Whether user is typing' })
  @IsBoolean()
  isTyping: boolean;
}

// Response types
export interface MessageResponse {
  id: number;
  content: string;
  roomId: number;
  sender: {
    id: number;
    name: string;
    avatar: string | null;
  };
  createdAt: Date;
}

export interface RoomResponse {
  id: number;
  name: string | null;
  isPrivate: boolean;
  members: {
    id: number;
    name: string;
    avatar: string | null;
  }[];
  lastMessage?: MessageResponse;
  unreadCount: number;
  updatedAt: Date;
  createdAt: Date;
}

export class MarkAsReadDto {
  @IsInt()
  @Min(1)
  roomId: number;
}

export interface OnlineStatusResponse {
  userId: number;
  isOnline: boolean;
  lastSeen?: Date;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsString,
  IsInt,
  IsOptional,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  Min,
  Max,
  MinLength,
  MaxLength,
} from 'class-validator';
import {
  optionalTrimString,
  trimString,
} from '../../../common/dto/string.transforms';

export class CreateRoomDto {
  @ApiPropertyOptional({
    description: 'Room name (optional for private chats)',
  })
  @Transform(optionalTrimString)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ description: 'Array of user IDs to add to the room' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(1, { each: true })
  memberIds: number[];

  @ApiPropertyOptional({
    description: 'Whether the room is private',
    default: true,
  })
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
  @Transform(trimString)
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

export class GetMessagesDto {
  @ApiProperty({ description: 'Room ID' })
  @IsInt()
  @Min(1)
  roomId: number;

  @ApiPropertyOptional({
    description: 'Number of messages to fetch',
    default: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Load messages before this message ID (cursor)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  before?: number;
}

export class TypingDto {
  @ApiProperty({ description: 'Room ID' })
  @IsInt()
  @Min(1)
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
    lastReadAt?: Date;
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

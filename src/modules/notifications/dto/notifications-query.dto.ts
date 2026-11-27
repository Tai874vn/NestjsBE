/**
 * Notifications module DTO that validates cursor and limit query parameters for listing notifications.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/modules/notifications/controllers/notifications.controller.ts
 *   - src/modules/notifications/services/notifications.service.ts
 */

import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class NotificationsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

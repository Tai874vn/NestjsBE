/**
 * Query parameter DTO for listing connections and suggestions in the connections module.
 * It validates pagination (page, pageSize) and an optional search keyword.
 *
 * Calls: optionalTrimString
 * Used by:
 *   - src/modules/connections/controllers/connections.controller.ts
 *   - src/modules/connections/services/connections.service.ts
 */

import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { optionalTrimString } from '../../../common/dto/string.transforms';

export class ConnectionsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize: number = 12;

  @IsOptional()
  @Transform(optionalTrimString)
  @IsString()
  @MaxLength(80)
  keyword?: string;
}

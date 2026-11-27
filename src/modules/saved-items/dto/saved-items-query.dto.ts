/**
 * Query DTO for the saved-items module. Validates the optional cursor and page size when listing saved posts or jobs.
 *
 * Calls: nothing from this project
 * Used by:
 *   - src/modules/saved-items/controllers/saved-items.controller.ts
 *   - src/modules/saved-items/services/saved-items.service.ts
 */

import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SavedItemsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit: number = 10;
}

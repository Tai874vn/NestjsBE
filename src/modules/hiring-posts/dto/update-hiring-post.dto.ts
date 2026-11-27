/**
 * Request body DTO for editing a hiring post in the hiring-posts module. Makes all fields from CreateHiringPostDto optional and adds an optional post status field.
 *
 * Calls: CreateHiringPostDto
 * Used by:
 *   - src/modules/hiring-posts/controllers/hiring-posts.controller.ts
 *   - src/modules/hiring-posts/services/hiring-posts.service.ts
 *   - src/modules/hiring-posts/utils/hiring-post-update.ts
 */

import { PartialType } from '@nestjs/mapped-types';
import { HiringPostStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { CreateHiringPostDto } from './create-hiring-post.dto';

export class UpdateHiringPostDto extends PartialType(CreateHiringPostDto) {
  @IsOptional()
  @IsEnum(HiringPostStatus)
  status?: HiringPostStatus;
}

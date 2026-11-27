/**
 * Request DTO for the subcategories module. Makes all fields of CreateSubcategoryDto optional for updating a subcategory.
 *
 * Calls: CreateSubcategoryDto
 * Used by:
 *   - src/modules/subcategories/controllers/subcategories.controller.ts
 *   - src/modules/subcategories/services/subcategories.service.ts
 */

import { PartialType } from '@nestjs/mapped-types';
import { CreateSubcategoryDto } from './create-subcategory.dto';

export class UpdateSubcategoryDto extends PartialType(CreateSubcategoryDto) {}

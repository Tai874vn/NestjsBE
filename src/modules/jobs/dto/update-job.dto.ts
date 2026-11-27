/**
 * Request body DTO for updating a job post in the jobs module. Makes all fields from CreateJobDto optional.
 *
 * Calls: CreateJobDto
 * Used by:
 *   - src/modules/jobs/controllers/jobs.controller.ts
 *   - src/modules/jobs/services/job-mutation.service.ts
 *   - src/modules/jobs/services/jobs.service.ts
 */

import { PartialType } from '@nestjs/mapped-types';
import { CreateJobDto } from './create-job.dto';

export class UpdateJobDto extends PartialType(CreateJobDto) {}

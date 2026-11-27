/**
 * NestJS module for the comments (reviews) feature.
 * It imports ContractsModule, registers CommentsController, and registers and exports CommentsService.
 *
 * Calls: ContractsModule; CommentsController; CommentsService
 * Used by:
 *   - src/app.module.ts
 */

import { Module } from '@nestjs/common';
import { CommentsService } from './services/comments.service';
import { ContractsModule } from '../contracts/contracts.module';
import { CommentsController } from './controllers/comments.controller';

@Module({
  imports: [ContractsModule],
  controllers: [CommentsController],
  providers: [CommentsService],
  exports: [CommentsService],
})
export class CommentsModule {}

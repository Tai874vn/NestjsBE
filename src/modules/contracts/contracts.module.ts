import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContractEventsService } from './contract-events.service';
import { ContractFilesController } from './controllers/contract-files.controller';
import { ProposalsController } from './controllers/proposals.controller';
import { ProposalsService } from './proposals.service';

/**
 * Service contracts: proposals, contracts and milestones.
 * It holds the history rows, notifications and chat lines (ContractEventsService), the proposals
 * with their versions (ProposalsService, answered over HTTP by ProposalsController) and the image
 * upload for proposals and submissions (ContractFilesController; CloudinaryModule is global).
 * The contract and milestone actions join it in later tasks.
 */
@Module({
  imports: [NotificationsModule, ChatModule],
  controllers: [ProposalsController, ContractFilesController],
  providers: [ContractEventsService, ProposalsService],
  exports: [ContractEventsService],
})
export class ContractsModule {}

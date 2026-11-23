import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { ContractEndingService } from './contract-ending.service';
import { ContractEventsService } from './contract-events.service';
import { ContractStepService } from './contract-step.service';
import { ContractFilesController } from './controllers/contract-files.controller';
import { ContractsController } from './controllers/contracts.controller';
import { MilestonesController } from './controllers/milestones.controller';
import { ProposalsController } from './controllers/proposals.controller';
import { ContractsQueryService } from './contracts-query.service';
import { ContractsService } from './contracts.service';
import { ProposalsService } from './proposals.service';

/**
 * Service contracts: proposals, contracts and milestones.
 * It holds the history rows, notifications and chat lines (ContractEventsService), the proposals
 * with their versions (ProposalsService, answered over HTTP by ProposalsController), the image
 * upload for proposals and submissions (ContractFilesController; CloudinaryModule is global),
 * and the contracts: reading (ContractsQueryService), the lock-and-run helper of every contract
 * step (ContractStepService), the milestone steps and the client's own end (ContractsService,
 * answered by ContractsController and MilestonesController) and the early end shared with the
 * later amendment, end-request and sweeper code (ContractEndingService).
 */
@Module({
  imports: [NotificationsModule, ChatModule, WalletModule],
  controllers: [
    ProposalsController,
    ContractFilesController,
    ContractsController,
    MilestonesController,
  ],
  providers: [
    ContractEventsService,
    ProposalsService,
    ContractsQueryService,
    ContractStepService,
    ContractsService,
    ContractEndingService,
  ],
  exports: [ContractEventsService, ContractStepService, ContractEndingService],
})
export class ContractsModule {}

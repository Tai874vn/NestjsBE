import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WalletModule } from '../wallet/wallet.module';
import { AmendmentsService } from './services/amendments.service';
import { ContractEndingService } from './services/contract-ending.service';
import { ContractEventsService } from './services/contract-events.service';
import { ContractStepService } from './services/contract-step.service';
import { ContractSweeperService } from './services/contract-sweeper.service';
import { AmendmentsController } from './controllers/amendments.controller';
import { ContractFilesController } from './controllers/contract-files.controller';
import { ContractsController } from './controllers/contracts.controller';
import { MilestonesController } from './controllers/milestones.controller';
import { ProposalsController } from './controllers/proposals.controller';
import { ContractsQueryService } from './services/contracts-query.service';
import { ContractsService } from './services/contracts.service';
import { ProposalsService } from './services/proposals.service';

/**
 * Service contracts: proposals, contracts and milestones.
 * It holds the history rows, notifications and chat lines (ContractEventsService), the proposals
 * with their versions (ProposalsService, answered over HTTP by ProposalsController), the image
 * upload for proposals and submissions (ContractFilesController; StorageModule is global),
 * and the contracts: reading (ContractsQueryService), the lock-and-run helper of every contract
 * step (ContractStepService), the milestone steps and the client's own end (ContractsService,
 * answered by ContractsController and MilestonesController) and the early end shared with the
 * sweeper and the mutual end (ContractEndingService), and the amendments and end requests
 * (AmendmentsService, answered by AmendmentsController and ContractsController), and the sweeper
 * (ContractSweeperService), a timer that applies the deadline rules and expires old proposals.
 */
@Module({
  imports: [NotificationsModule, ChatModule, WalletModule],
  controllers: [
    ProposalsController,
    ContractFilesController,
    ContractsController,
    MilestonesController,
    AmendmentsController,
  ],
  providers: [
    ContractEventsService,
    ProposalsService,
    ContractsQueryService,
    ContractStepService,
    ContractsService,
    ContractEndingService,
    AmendmentsService,
    ContractSweeperService,
  ],
  exports: [ContractEventsService, ContractStepService, ContractEndingService],
})
export class ContractsModule {}

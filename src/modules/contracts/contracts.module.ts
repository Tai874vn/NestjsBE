import { Module } from '@nestjs/common';
import { ChatModule } from '../chat/chat.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ContractEventsService } from './contract-events.service';

/**
 * Service contracts: proposals, contracts and milestones.
 * For now it holds the history rows, notifications and chat lines (ContractEventsService).
 * The wallet, proposal and contract services join it in later tasks.
 */
@Module({
  imports: [NotificationsModule, ChatModule],
  providers: [ContractEventsService],
  exports: [ContractEventsService],
})
export class ContractsModule {}

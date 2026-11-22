import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatGateway } from './gateways/chat.gateway';
import { ChatMessageFanoutService } from './services/chat-message-fanout.service';
import { ChatPresenceService } from './services/chat-presence.service';
import { ChatService } from './services/chat.service';
import { ChatSocketAuthService } from './services/chat-socket-auth.service';
import { ChatSocketRateLimitService } from './services/chat-socket-rate-limit.service';
import { ChatController } from './controllers/chat.controller';
import { NotificationsModule } from '../notifications/notifications.module';
import { ObservabilityModule } from '../../common/observability/observability.module';

@Module({
  imports: [ObservabilityModule, NotificationsModule, AuthModule],
  controllers: [ChatController],
  providers: [
    ChatGateway,
    ChatMessageFanoutService,
    ChatPresenceService,
    ChatService,
    ChatSocketAuthService,
    ChatSocketRateLimitService,
  ],
  exports: [ChatService, ChatGateway, ChatMessageFanoutService],
})
export class ChatModule {}

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChatGateway } from './gateways/chat.gateway';
import { ChatPresenceService } from './services/chat-presence.service';
import { ChatService } from './services/chat.service';
import { ChatSocketAuthService } from './services/chat-socket-auth.service';
import { ChatController } from './controllers/chat.controller';
import { PrismaService } from '../../prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { ObservabilityModule } from '../../common/observability/observability.module';

@Module({
  imports: [
    ObservabilityModule,
    NotificationsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [ChatController],
  providers: [ChatGateway, ChatPresenceService, ChatService, ChatSocketAuthService, PrismaService],
  exports: [ChatService],
})
export class ChatModule {}

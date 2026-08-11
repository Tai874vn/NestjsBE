import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from '../../prisma.service';
import { ObservabilityModule } from '../../common/observability/observability.module';
import { NotificationsController } from './controllers/notifications.controller';
import { NotificationsGateway } from './gateways/notifications.gateway';
import { NotificationPresenterService } from './services/notification-presenter.service';
import { NotificationTemplateService } from './services/notification-template.service';
import { NotificationsService } from './services/notifications.service';

@Module({
  imports: [
    ObservabilityModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
      }),
    }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationPresenterService,
    NotificationTemplateService,
    NotificationsService,
    NotificationsGateway,
    PrismaService,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}

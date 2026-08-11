import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PostsController } from './controllers/posts.controller';
import { PostsService } from './services/posts.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PostsController],
  providers: [PostsService, PrismaService],
})
export class PostsModule {}

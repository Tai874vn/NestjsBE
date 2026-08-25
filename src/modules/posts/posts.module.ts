import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { PostsController } from './controllers/posts.controller';
import { PostsService } from './services/posts.service';

@Module({
  imports: [NotificationsModule],
  controllers: [PostsController],
  providers: [PostsService],
})
export class PostsModule {}

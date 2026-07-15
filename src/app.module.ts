import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { ThrottlerModule } from '@nestjs/throttler';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { SubcategoriesModule } from './modules/subcategories/subcategories.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { CommentsModule } from './modules/comments/comments.module';
import { HiresModule } from './modules/hires/hires.module';
import { SkillModule } from './modules/skill/skill.module';
import { CloudinaryModule } from './modules/cloudinary/cloudinary.module';
import { ChatModule } from './modules/chat/chat.module';
import { envValidationSchema } from './config/env.validation';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { PostsModule } from './modules/posts/posts.module';
import { SavedItemsModule } from './modules/saved-items/saved-items.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { AdminModule } from './modules/admin/admin.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { CsrfGuard } from './common/guards/csrf.guard';
import { HttpThrottlerGuard } from './common/guards/http-throttler.guard';
import { RequestObservabilityInterceptor } from './common/observability/request-observability.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: true, // Stop validation at first error
      },
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),
    ThrottlerModule.forRoot([
      { name: 'default', ttl: 60_000, limit: 120 },
    ]),
    ObservabilityModule,
    RedisModule,
    CloudinaryModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    SubcategoriesModule,
    JobsModule,
    CommentsModule,
    HiresModule,
    SkillModule,
    ChatModule,
    RecommendationsModule,
    PostsModule,
    SavedItemsModule,
    ConnectionsModule,
    NotificationsModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_INTERCEPTOR, useClass: RequestObservabilityInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
  ],
})
export class AppModule {}

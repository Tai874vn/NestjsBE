import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { SentryModule } from '@sentry/nestjs/setup';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { SubcategoriesModule } from './modules/subcategories/subcategories.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { HiringPostsModule } from './modules/hiring-posts/hiring-posts.module';
import { CommentsModule } from './modules/comments/comments.module';
import { SkillModule } from './modules/skill/skill.module';
import { OccupationsModule } from './modules/occupations/occupations.module';
import { StorageModule } from './modules/storage/storage.module';
import { ChatModule } from './modules/chat/chat.module';
import { envValidationSchema } from './config/env.validation';
import { RecommendationsModule } from './modules/recommendations/recommendations.module';
import { PostsModule } from './modules/posts/posts.module';
import { SavedItemsModule } from './modules/saved-items/saved-items.module';
import { ConnectionsModule } from './modules/connections/connections.module';
import { AdminModule } from './modules/admin/admin.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { HiringPipelineModule } from './modules/hiring-pipeline/hiring-pipeline.module';
import { WalletModule } from './modules/wallet/wallet.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { ObservabilityModule } from './common/observability/observability.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { CsrfGuard } from './common/guards/csrf.guard';
import { HttpThrottlerGuard } from './common/guards/http-throttler.guard';
import { RequestObservabilityInterceptor } from './common/observability/request-observability.interceptor';
import { AllExceptionsFilter } from './common/errors/all-exceptions.filter';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: true, // Stop validation at first error
      },
    }),
    ThrottlerModule.forRoot({
      errorMessage: 'Too many requests. Please try again shortly.',
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
    }),
    ObservabilityModule,
    DatabaseModule,
    RedisModule,
    StorageModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    SubcategoriesModule,
    JobsModule,
    HiringPostsModule,
    CommentsModule,
    SkillModule,
    OccupationsModule,
    ChatModule,
    RecommendationsModule,
    PostsModule,
    SavedItemsModule,
    ConnectionsModule,
    NotificationsModule,
    HiringPipelineModule,
    WalletModule,
    ContractsModule,
    AdminModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestObservabilityInterceptor },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: HttpThrottlerGuard },
  ],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
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
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

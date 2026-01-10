import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { LoaiCongViecModule } from './modules/loai-cong-viec/loai-cong-viec.module';
import { ChiTietLoaiCongViecModule } from './modules/chi-tiet-loai-cong-viec/chi-tiet-loai-cong-viec.module';
import { CongViecModule } from './modules/cong-viec/cong-viec.module';
import { BinhLuanModule } from './modules/binh-luan/binh-luan.module';
import { ThueCongViecModule } from './modules/thue-cong-viec/thue-cong-viec.module';
import { SkillModule } from './modules/skill/skill.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'uploads'),
      serveRoot: '/uploads',
    }),
    AuthModule,
    UsersModule,
    LoaiCongViecModule,
    ChiTietLoaiCongViecModule,
    CongViecModule,
    BinhLuanModule,
    ThueCongViecModule,
    SkillModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

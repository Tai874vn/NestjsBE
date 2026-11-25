import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import { buildCorsOptions } from './common/config/cors-options';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.use(helmet());
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix(process.env.GLOBAL_PREFIX!);
  app.enableCors(buildCorsOptions());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis(redisUrl);
    app.useWebSocketAdapter(redisIoAdapter);
  }

  await app.listen(process.env.PORT!);
}
void bootstrap();

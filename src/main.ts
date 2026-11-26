import './instrument';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { createClient } from 'redis';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import { buildCorsOptions } from './common/config/cors-options';
import { applyApiCacheControl } from './common/middleware/cache-control.middleware';
import { devPublicImages } from './common/middleware/dev-public-images';
import { REDIS_CLIENT } from './modules/redis/utils/redis.constants';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  app.use(helmet());
  app.use(
    json({
      limit: '1mb',
      // Stripe signs the exact request bytes, so the webhook keeps its raw body (and only it).
      verify: (req, _res, buf) => {
        const request = req as typeof req & {
          originalUrl?: string;
          rawBody?: Buffer;
        };
        if (request.originalUrl?.endsWith('/payments/stripe/webhook'))
          request.rawBody = Buffer.from(buf);
      },
    }),
  );
  app.use(urlencoded({ extended: false, limit: '1mb' }));
  app.use(cookieParser());
  // Local development has no nginx: the backend serves public images itself (never in production).
  const publicImages = devPublicImages();
  if (publicImages) app.use('/uploads/images', publicImages);
  app.use(applyApiCacheControl);
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

  // Reuse the single shared REDIS_CLIENT for the Socket.IO adapter so no connection is leaked.
  const redisClient = app.get<ReturnType<typeof createClient> | null>(
    REDIS_CLIENT,
  );
  if (redisClient) {
    const redisIoAdapter = new RedisIoAdapter(app);
    await redisIoAdapter.connectToRedis(redisClient);
    app.useWebSocketAdapter(redisIoAdapter);
  }

  await app.listen(process.env.PORT!);
}
void bootstrap();

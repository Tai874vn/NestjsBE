import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // Database
  DATABASE_URL: Joi.string().required(),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).max(50).default(10),
  DATABASE_CONNECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .default(10_000),
  DATABASE_IDLE_TIMEOUT_MS: Joi.number().integer().min(1000).default(30_000),

  // JWT
  JWT_SECRET: Joi.string().min(64).required(),
  JWT_EXPIRES_IN: Joi.string().required(),

  // Google OAuth
  GOOGLE_CLIENT_ID: Joi.string().required(),
  GOOGLE_CLIENT_SECRET: Joi.string().required(),
  GOOGLE_CALLBACK_URL: Joi.string().uri().required(),

  // Frontend
  FRONTEND_URL: Joi.string().uri().required(),

  // Server
  PORT: Joi.number().required(),
  GLOBAL_PREFIX: Joi.string().required(),
  NODE_ENV: Joi.string().valid('development', 'production', 'test').required(),

  // Redis (optional)
  REDIS_URL: Joi.string().uri().optional(),

  // AI recommendation service
  AI_SERVICE_URL: Joi.string().uri().required(),
  AI_SERVICE_API_KEY: Joi.string().min(32).required(),
  AI_SERVICE_TIMEOUT_MS: Joi.number().optional(),
  AI_RECOMMENDATION_MODEL_VERSION: Joi.string().max(100).default('current'),
  RECOMMENDATION_SNAPSHOT_MAX_AGE_SECONDS: Joi.number()
    .integer()
    .min(300)
    .default(86_400),

  // Cloudinary (if used)
  CLOUDINARY_CLOUD_NAME: Joi.string().empty('').optional(),
  CLOUDINARY_API_KEY: Joi.string().empty('').optional(),
  CLOUDINARY_API_SECRET: Joi.string().empty('').optional(),
});

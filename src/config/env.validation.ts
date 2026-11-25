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
  JWT_EXPIRES_IN: Joi.string()
    .custom((value: string, helpers) => {
      const match = /^(\d+)(m|s)$/.exec(value);
      if (!match) return helpers.error('any.invalid');
      const seconds = Number(match[1]) * (match[2] === 'm' ? 60 : 1);
      return seconds >= 300 && seconds <= 900
        ? value
        : helpers.error('any.invalid');
    })
    .default('10m'),
  JWT_ISSUER: Joi.string().max(200).default('jobaura'),
  JWT_AUDIENCE: Joi.string().max(200).default('jobaura-api'),
  AUTH_REFRESH_TTL_DAYS: Joi.number().integer().min(7).max(30).default(14),
  AUTH_REDIS_URL: Joi.string().uri().optional(),
  AUTH_REDIS_PASSWORD: Joi.string().min(32).optional(),
  AUTH_REDIS_PASSWORD_FILE: Joi.string().optional(),
  AUTH_REDIS_COMMAND_TIMEOUT_MS: Joi.number()
    .integer()
    .min(50)
    .max(2000)
    .default(200),
  AUTH_REDIS_CONNECT_TIMEOUT_MS: Joi.number()
    .integer()
    .min(100)
    .max(5000)
    .default(1000),

  // Google OAuth
  GOOGLE_CLIENT_ID: Joi.string().required(),
  GOOGLE_CLIENT_SECRET: Joi.string().required(),
  GOOGLE_CALLBACK_URL: Joi.string().uri().required(),

  // Frontend
  FRONTEND_URL: Joi.string().uri().required(),
  // Extra trusted frontend origins for local testing, comma-separated; leave unset in production.
  DEV_FRONTEND_ORIGINS: Joi.string().optional(),

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
  // How often the resume AI queue checks for work; 0 turns the background worker off.
  RESUME_AI_QUEUE_INTERVAL_MS: Joi.number().integer().min(0).optional(),
  HIRING_POST_AI_QUEUE_INTERVAL_MS: Joi.number().integer().min(0).optional(),

  // Service contracts: the length in minutes of every 3-day deadline window (4320 = 3 days;
  // a small number such as 10 makes a demo quick), and how often the sweeper runs (0 = off).
  CONTRACT_GRACE_MINUTES: Joi.number().integer().min(1).default(4320),
  CONTRACT_SWEEP_INTERVAL_MS: Joi.number().integer().min(0).default(60000),
  AI_RECOMMENDATION_MODEL_VERSION: Joi.string().max(100).default('current'),
  RECOMMENDATION_SNAPSHOT_MAX_AGE_SECONDS: Joi.number()
    .integer()
    .min(300)
    .default(86_400),

  // LiveKit video calls (optional: without them the call-token endpoint answers 503)
  LIVEKIT_URL: Joi.string().empty('').optional(),
  LIVEKIT_API_KEY: Joi.string().empty('').optional(),
  LIVEKIT_API_SECRET: Joi.string().empty('').optional(),

  // VNPay sandbox top-up (optional: without TMN code, hash secret and return URL the top-up is
  // hidden and POST /wallet/top-ups answers 503)
  VNPAY_TMN_CODE: Joi.string().empty('').optional(),
  VNPAY_HASH_SECRET: Joi.string().empty('').optional(),
  VNPAY_PAY_URL: Joi.string()
    .uri()
    .empty('')
    .default('https://sandbox.vnpayment.vn/paymentv2/vpcpay.html'),
  VNPAY_RETURN_URL: Joi.string().uri().empty('').optional(),

  // Local file storage root (defaults to /app/uploads in production, ./uploads locally)
  UPLOADS_DIR: Joi.string().empty('').optional(),

  // Deprecated: Cloudinary package and env vars stay only until `npm run migrate:files` has run.
  CLOUDINARY_CLOUD_NAME: Joi.string().empty('').optional(),
  CLOUDINARY_API_KEY: Joi.string().empty('').optional(),
  CLOUDINARY_API_SECRET: Joi.string().empty('').optional(),

  // Sentry error tracking and performance tracing (optional; empty DSN turns Sentry off)
  SENTRY_DSN: Joi.string().uri().empty('').optional(),
  SENTRY_ENVIRONMENT: Joi.string().max(64).empty('').optional(),
  SENTRY_RELEASE: Joi.string().max(200).empty('').optional(),
  SENTRY_TRACES_SAMPLE_RATE: Joi.number().min(0).max(1).empty('').optional(),
});

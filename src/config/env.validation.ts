import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  // Database
  DATABASE_URL: Joi.string().required(),

  // JWT
  JWT_SECRET: Joi.string().required(),
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

  // Cloudinary (if used)
  CLOUDINARY_CLOUD_NAME: Joi.string().optional(),
  CLOUDINARY_API_KEY: Joi.string().optional(),
  CLOUDINARY_API_SECRET: Joi.string().optional(),
});

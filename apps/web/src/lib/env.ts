import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * Validated environment. Import `env` instead of reading `process.env` directly so a
 * missing or malformed variable fails fast at boot with a clear message.
 */
export const env = createEnv({
  server: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url(),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),
    REDIS_URL: z.url().optional(),
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    EMAIL_FROM: z.string().min(1).default('Saylani Job Bank <no-reply@jobbank.local>'),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_SECURE: z.stringbool().default(false),
    // 'memory' keeps emails in-process (tests); 'smtp' sends them (Mailpit locally).
    MAIL_TRANSPORT: z.enum(['smtp', 'memory']).default('smtp'),
    // ≥32 random chars; signs sessions and keys OTP hashes. Required in production
    // (lib/auth falls back to a fixed development secret only outside production).
    BETTER_AUTH_SECRET: z.string().min(32).optional(),
    // SMS gateway for OTP codes. 'console' prints codes to the server log (development only).
    SMS_PROVIDER: z.enum(['console']).default('console'),
    OPENCAGE_API_KEY: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.url(),
    // OSM's public tiles are fine for development only; use a provider for production traffic.
    NEXT_PUBLIC_MAP_TILE_URL: z
      .string()
      .min(1)
      .default('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),
    NEXT_PUBLIC_MAP_ATTRIBUTION: z
      .string()
      .min(1)
      .default(
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      ),
  },
  experimental__runtimeEnv: {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_MAP_TILE_URL: process.env.NEXT_PUBLIC_MAP_TILE_URL,
    NEXT_PUBLIC_MAP_ATTRIBUTION: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION,
  },
  emptyStringAsUndefined: true,
  skipValidation: Boolean(process.env.SKIP_ENV_VALIDATION),
});

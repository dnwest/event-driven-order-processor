import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  AWS_REGION: z.string().default('us-east-1'),
  AWS_ACCESS_KEY_ID: z.string().default('test'),
  AWS_SECRET_ACCESS_KEY: z.string().default('test'),
  AWS_ENDPOINT: z.string().default('http://localhost:4566'),
  SNS_TOPIC_ARN: z
    .string()
    .default('arn:aws:sns:us-east-1:000000000000:orders-events-topic'),
  SQS_QUEUE_URL: z
    .string()
    .default('http://localhost:4566/000000000000/orders-queue'),
  SQS_DLQ_URL: z
    .string()
    .default('http://localhost:4566/000000000000/orders-dlq'),
  METRICS_PORT: z.coerce.number().int().positive().default(9464),
  // In-memory is the zero-dependency default; Redis is what makes running more
  // than one worker safe.
  IDEMPOTENCY_STORE: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86_400),
  QUEUE_DEPTH_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  LOG_LEVEL: z
    .enum(['debug', 'info', 'warn', 'error', 'silent'])
    .default('info'),
});

export const env = envSchema.parse(process.env);

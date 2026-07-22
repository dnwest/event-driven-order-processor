import Redis from 'ioredis';
import { logger } from '../observability/logger.js';

/**
 * Redis connection for the shared idempotency store.
 *
 * `maxRetriesPerRequest: 1` keeps a command from queueing indefinitely while
 * Redis is unreachable: it fails fast, the message stays on the queue and SQS
 * redelivers it, instead of the worker stalling with messages in flight.
 */
export function createRedisClient(url: string): Redis {
  const client = new Redis(url, { maxRetriesPerRequest: 1 });

  client.on('error', (error) => logger.error({ error }, 'Redis connection error'));
  client.on('ready', () => logger.info('Redis connected'));

  return client;
}

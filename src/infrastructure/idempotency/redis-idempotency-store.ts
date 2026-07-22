import { logger } from '../observability/logger.js';
import type { IdempotencyStore } from './order-idempotency.js';

/**
 * The two commands this store needs, so it can be unit-tested with a fake and
 * is not coupled to one Redis client library.
 */
export interface RedisCommands {
  exists(key: string): Promise<number>;
  set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<unknown>;
}

export interface RedisIdempotencyStoreOptions {
  client: RedisCommands;
  /**
   * How long a processed `orderId` is remembered. It only has to outlive the
   * window in which SQS can still redeliver the message — bounded by the DLQ's
   * retention — so keys expire instead of growing forever.
   */
  ttlSeconds?: number;
  keyPrefix?: string;
}

/**
 * Dedupe store shared by every worker instance.
 *
 * The in-memory store is per-process, so with more than one worker a duplicate
 * delivered to a different instance is reprocessed. Redis moves that state out
 * of the process.
 *
 * A store outage propagates: the handler rejects, the message is left on the
 * queue and redrive eventually dead-letters it. That is deliberate — processing
 * an order we cannot deduplicate risks charging a customer twice, and a message
 * kept in the DLQ can be replayed once Redis is back.
 */
export class RedisIdempotencyStore implements IdempotencyStore {
  private readonly client: RedisCommands;
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;

  constructor(options: RedisIdempotencyStoreOptions) {
    this.client = options.client;
    this.ttlSeconds = options.ttlSeconds ?? 86_400;
    this.keyPrefix = options.keyPrefix ?? 'order:processed:';
  }

  async has(orderId: string): Promise<boolean> {
    return (await this.client.exists(this.key(orderId))) > 0;
  }

  async add(orderId: string): Promise<void> {
    await this.client.set(this.key(orderId), '1', 'EX', this.ttlSeconds);
    logger.debug({ orderId, ttlSeconds: this.ttlSeconds }, 'Order recorded as processed');
  }

  private key(orderId: string): string {
    return `${this.keyPrefix}${orderId}`;
  }
}

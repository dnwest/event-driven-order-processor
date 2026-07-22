import { logger } from '../observability/logger.js';
import type { OrderHandler } from '../../domain/process-order.js';

/**
 * Records which orders have already been processed, so at-least-once redelivery
 * can be deduplicated. Async by design: the in-memory implementation is enough
 * for the demo, but the same interface fits a Redis set or a small table when
 * the worker is scaled out.
 */
export interface IdempotencyStore {
  has(orderId: string): Promise<boolean>;
  add(orderId: string): Promise<void>;
}

export interface IdempotencyOptions {
  /** Called when a re-delivered order is skipped, for metrics. */
  onDuplicate?: (orderId: string) => void;
}

/** Process-local store. Fine for a single worker; not shared across instances. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly seen = new Set<string>();

  async has(orderId: string): Promise<boolean> {
    return this.seen.has(orderId);
  }

  async add(orderId: string): Promise<void> {
    this.seen.add(orderId);
  }
}

/**
 * Wraps a handler so an already-processed `orderId` is skipped as a no-op.
 *
 * The order is recorded **only after** the inner handler succeeds — a failed
 * order is left unrecorded so a later redelivery is reprocessed rather than
 * silently dropped. Because a duplicate resolves without error, the consumer
 * deletes the message, removing the duplicate from the queue.
 */
export function withIdempotency(
  handler: OrderHandler,
  store: IdempotencyStore,
  options: IdempotencyOptions = {}
): OrderHandler {
  const { onDuplicate = () => {} } = options;

  return async (order) => {
    if (await store.has(order.orderId)) {
      logger.info(
        { orderId: order.orderId },
        'Duplicate order skipped (idempotent no-op)'
      );
      onDuplicate(order.orderId);
      return;
    }

    await handler(order);
    await store.add(order.orderId);
  };
}

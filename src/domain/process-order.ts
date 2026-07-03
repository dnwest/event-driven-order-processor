import { logger } from '../infrastructure/observability/logger.js';
import type { OrderEvent } from './order.schema.js';

/**
 * Port for the downstream business step (the "save to database" box in the
 * architecture diagram). Kept as an injectable function so the consumer can be
 * unit-tested without a real dependency, and so the Circuit Breaker / retry
 * work on the roadmap can wrap this seam.
 */
export type OrderHandler = (order: OrderEvent) => Promise<void>;

/**
 * Default order processor.
 *
 * For the LocalStack demo this simulates a downstream database failure for
 * high-value orders so the DLQ / redrive path can be exercised end-to-end.
 */
export const processOrder: OrderHandler = async (order) => {
  logger.debug({ orderId: order.orderId }, 'Business logic processing started');

  if (order.amount > 1000) {
    throw new Error('Simulated database failure for high-value orders');
  }

  logger.info({ orderId: order.orderId }, 'Order successfully saved to database');
};

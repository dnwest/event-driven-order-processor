import CircuitBreaker from 'opossum';
import { logger } from '../observability/logger.js';
import type { OrderEvent } from '../../domain/order.schema.js';
import type { OrderHandler } from '../../domain/process-order.js';

export interface OrderBreakerOptions {
  /** Max time (ms) a single downstream call may take before it counts as a failure. */
  timeout?: number;
  /** Time (ms) the circuit stays open before it half-opens to probe recovery. */
  resetTimeout?: number;
  /** Minimum calls in the rolling window before the breaker may trip. */
  volumeThreshold?: number;
  /** Error rate (%) within the window that trips the breaker once volume is met. */
  errorThresholdPercentage?: number;
}

const DEFAULTS: Required<OrderBreakerOptions> = {
  timeout: 3_000,
  resetTimeout: 10_000,
  volumeThreshold: 5,
  errorThresholdPercentage: 50,
};

export interface OrderBreaker {
  /** Drop-in replacement for the wrapped handler, guarded by the breaker. */
  handler: OrderHandler;
  /** The underlying breaker, exposed for lifecycle control and inspection. */
  breaker: CircuitBreaker<[OrderEvent], void>;
}

/**
 * Wraps the downstream order handler in a circuit breaker.
 *
 * When the downstream dependency fails repeatedly the circuit opens and further
 * calls short-circuit (reject immediately) instead of hammering a dead
 * dependency. Because the wrapped handler rejects while open, the consumer never
 * deletes the message — it flows back to the queue and, after `maxReceiveCount`
 * redeliveries, to the DLQ. Validation happens upstream of this seam, so only
 * genuine downstream failures are ever counted against the breaker.
 */
export function withCircuitBreaker(
  handler: OrderHandler,
  options: OrderBreakerOptions = {}
): OrderBreaker {
  const config = { ...DEFAULTS, ...options };

  const breaker = new CircuitBreaker<[OrderEvent], void>(
    (order) => handler(order),
    {
      name: 'order-downstream',
      timeout: config.timeout,
      resetTimeout: config.resetTimeout,
      volumeThreshold: config.volumeThreshold,
      errorThresholdPercentage: config.errorThresholdPercentage,
    }
  );

  breaker.on('open', () =>
    logger.error(
      { breaker: breaker.name, resetTimeout: config.resetTimeout },
      'Circuit breaker OPEN — short-circuiting downstream calls'
    )
  );
  breaker.on('halfOpen', () =>
    logger.warn(
      { breaker: breaker.name },
      'Circuit breaker HALF-OPEN — probing downstream recovery'
    )
  );
  breaker.on('close', () =>
    logger.info(
      { breaker: breaker.name },
      'Circuit breaker CLOSED — downstream healthy'
    )
  );

  return { handler: (order) => breaker.fire(order), breaker };
}

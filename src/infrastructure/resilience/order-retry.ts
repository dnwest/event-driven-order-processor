import { logger } from '../observability/logger.js';
import type { OrderHandler } from '../../domain/process-order.js';

export interface RetryOptions {
  /** Retries after the initial attempt, so total attempts = maxRetries + 1. */
  maxRetries?: number;
  /** Delay (ms) for the first backoff; the cap doubles on each further retry. */
  baseDelayMs?: number;
  /** Upper bound (ms) on any single wait, so exponential growth stays sane. */
  maxDelayMs?: number;
  /**
   * Decides whether a thrown error is worth retrying. Transient faults (a brief
   * downstream outage) should retry; deterministic ones (bad input) should not.
   * Defaults to retrying everything — validation already fails upstream of this
   * seam, so only genuine downstream errors reach it.
   */
  isRetryable?: (error: unknown) => boolean;
  /** Injectable so tests can assert delays without waiting. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable so tests can pin the jitter; defaults to `Math.random`. */
  random?: () => number;
  /** Called once per scheduled retry, for metrics. */
  onRetry?: (attempt: number, delayMs: number) => void;
}

const DEFAULTS: Required<RetryOptions> = {
  maxRetries: 2,
  baseDelayMs: 100,
  maxDelayMs: 2_000,
  isRetryable: () => true,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
  onRetry: () => {},
};

/**
 * Wraps a handler with bounded retries and exponential backoff + jitter.
 *
 * A transient downstream failure is retried in-process with growing, jittered
 * delays (AWS "full jitter": a random wait in `[0, cap]`, where `cap` doubles per
 * attempt up to `maxDelayMs`) so a brief blip is absorbed instead of handing the
 * message back to SQS. Once retries are exhausted the error propagates and the
 * consumer leaves the message on the queue for redrive/DLQ. Composed *inside* the
 * circuit breaker, so the breaker sees the final outcome — not each attempt — and
 * the retry budget stays well under the breaker's own timeout.
 */
export function withRetry(
  handler: OrderHandler,
  options: RetryOptions = {}
): OrderHandler {
  const { maxRetries, baseDelayMs, maxDelayMs, isRetryable, sleep, random, onRetry } =
    { ...DEFAULTS, ...options };

  return async (order) => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await handler(order);
      } catch (error) {
        if (attempt >= maxRetries || !isRetryable(error)) {
          throw error;
        }

        const cap = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        const delay = Math.round(random() * cap);
        logger.warn(
          { orderId: order.orderId, attempt: attempt + 1, delay },
          'Transient failure — retrying after backoff'
        );
        onRetry(attempt + 1, delay);
        await sleep(delay);
      }
    }
  };
}

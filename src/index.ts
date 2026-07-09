import { OrderSQSConsumer } from './presentation/sqs.consumer.js';
import { processOrder } from './domain/process-order.js';
import { withCircuitBreaker } from './infrastructure/resilience/order-breaker.js';
import { withRetry } from './infrastructure/resilience/order-retry.js';
import {
  InMemoryIdempotencyStore,
  withIdempotency,
} from './infrastructure/idempotency/order-idempotency.js';
import { logger } from './infrastructure/observability/logger.js';

// Compose the downstream handler from the inside out:
//   1. processOrder            — the business step ("save to database").
//   2. withRetry(...)          — absorb transient downstream blips with
//      exponential backoff + jitter before the message goes back to SQS.
//   3. withCircuitBreaker(...)  — repeated *final* failures open the circuit so
//      the worker fails fast instead of hammering a dead dependency.
//   4. withIdempotency(...)     — outermost, so a re-delivered (duplicate)
//      orderId is a no-op and never even reaches the retry/breaker layers.
// While a message fails or short-circuits, the handler rejects and the consumer
// leaves it on the queue, letting redrive/DLQ take over.
const { handler: guarded } = withCircuitBreaker(withRetry(processOrder));
const handler = withIdempotency(guarded, new InMemoryIdempotencyStore());

const consumer = new OrderSQSConsumer({ handler });

logger.info('Starting Event-Driven Order Processor Worker');

consumer.start().catch((error) => {
  logger.fatal({ error }, 'Worker crashed');
  process.exit(1);
});

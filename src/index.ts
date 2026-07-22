import { OrderSQSConsumer } from './presentation/sqs.consumer.js';
import { processOrder } from './domain/process-order.js';
import { withCircuitBreaker } from './infrastructure/resilience/order-breaker.js';
import { withRetry } from './infrastructure/resilience/order-retry.js';
import {
  InMemoryIdempotencyStore,
  withIdempotency,
} from './infrastructure/idempotency/order-idempotency.js';
import { logger } from './infrastructure/observability/logger.js';
import { createPrometheusMetrics } from './infrastructure/observability/metrics.js';
import { startMetricsServer } from './infrastructure/observability/metrics.server.js';
import { startQueueDepthPoller } from './infrastructure/observability/queue-depth.js';
import { sqsClient } from './infrastructure/aws/sqs.client.js';
import { env } from './config/env.js';

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
const { sink: metrics, registry } = createPrometheusMetrics();

const { handler: guarded } = withCircuitBreaker(
  withRetry(processOrder, { onRetry: () => metrics.retryScheduled() }),
  {
    onStateChange: (state) => metrics.circuitStateChanged(state),
    onReject: () => metrics.circuitRejected(),
  }
);
const handler = withIdempotency(guarded, new InMemoryIdempotencyStore(), {
  onDuplicate: () => metrics.duplicateSkipped(),
});

const consumer = new OrderSQSConsumer({ handler, metrics });

startMetricsServer({ registry, port: env.METRICS_PORT });
const queueDepth = startQueueDepthPoller({
  client: sqsClient,
  metrics,
  intervalMs: env.QUEUE_DEPTH_INTERVAL_MS,
  queues: [
    { label: 'main', url: env.SQS_QUEUE_URL },
    { label: 'dlq', url: env.SQS_DLQ_URL },
  ],
});
// Seed the gauges now, so a scrape before the first tick is not empty.
void queueDepth.poll();

logger.info('Starting Event-Driven Order Processor Worker');

consumer.start().catch((error) => {
  logger.fatal({ error }, 'Worker crashed');
  process.exit(1);
});

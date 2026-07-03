import { OrderSQSConsumer } from './presentation/sqs.consumer.js';
import { processOrder } from './domain/process-order.js';
import { withCircuitBreaker } from './infrastructure/resilience/order-breaker.js';
import { logger } from './infrastructure/observability/logger.js';

// Guard the downstream call with a circuit breaker: repeated failures open the
// circuit so the worker fails fast instead of hammering a dead dependency.
// While open, the handler rejects and the consumer leaves the message on the
// queue, letting redrive/DLQ take over.
const { handler } = withCircuitBreaker(processOrder);

const consumer = new OrderSQSConsumer({ handler });

logger.info('Starting Event-Driven Order Processor Worker');

consumer.start().catch((error) => {
  logger.fatal({ error }, 'Worker crashed');
  process.exit(1);
});

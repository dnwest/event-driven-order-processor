import { OrderSQSConsumer } from './presentation/sqs.consumer.js';
import { logger } from './infrastructure/observability/logger.js';

const consumer = new OrderSQSConsumer();

logger.info('Starting Event-Driven Order Processor Worker');

consumer.start().catch((error) => {
  logger.fatal({ error }, 'Worker crashed');
  process.exit(1);
});

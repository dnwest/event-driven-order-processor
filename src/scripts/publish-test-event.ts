import { randomUUID } from 'node:crypto';
import { OrderSNSPublisher } from '../infrastructure/aws/sns.publisher.js';
import { logger } from '../infrastructure/observability/logger.js';

const testOrder = {
  orderId: randomUUID(),
  customerId: 'customer-123',
  amount: 99.99,
  status: 'CREATED',
  createdAt: new Date().toISOString(),
};

const publisher = new OrderSNSPublisher();

async function main() {
  try {
    await publisher.publishOrderCreated(testOrder);
    logger.info({ order: testOrder }, 'Test event published successfully');
    process.exit(0);
  } catch (error) {
    logger.error({ error }, 'Failed to publish test event');
    process.exit(1);
  }
}

main();

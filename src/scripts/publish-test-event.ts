import { randomUUID } from 'node:crypto';
import { OrderSNSPublisher } from '../infrastructure/aws/sns.publisher.js';
import { logger } from '../infrastructure/observability/logger.js';

// Amounts over 1000 make the demo handler fail, which is how the retry,
// breaker and DLQ paths are exercised: `pnpm run dev:publish 1500`.
const amount = Number(process.argv[2] ?? 99.99);

const testOrder = {
  orderId: randomUUID(),
  customerId: 'customer-123',
  amount,
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

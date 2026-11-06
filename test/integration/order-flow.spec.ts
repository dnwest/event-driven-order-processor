import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublishCommand } from '@aws-sdk/client-sns';
import {
  DeleteMessageCommand,
  GetQueueAttributesCommand,
  ReceiveMessageCommand,
  SetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import { env } from '../../src/config/env.js';
import type { OrderEvent } from '../../src/domain/order.schema.js';
import { processOrder, type OrderHandler } from '../../src/domain/process-order.js';
import { snsClient } from '../../src/infrastructure/aws/sns.client.js';
import { OrderSNSPublisher } from '../../src/infrastructure/aws/sns.publisher.js';
import { sqsClient } from '../../src/infrastructure/aws/sqs.client.js';
import {
  InMemoryIdempotencyStore,
  withIdempotency,
} from '../../src/infrastructure/idempotency/order-idempotency.js';
import { withCircuitBreaker } from '../../src/infrastructure/resilience/order-breaker.js';
import { withRetry } from '../../src/infrastructure/resilience/order-retry.js';
import { OrderSQSConsumer } from '../../src/presentation/sqs.consumer.js';

// Lowered for the run so three redeliveries take seconds, not three minutes.
const TEST_VISIBILITY_SECONDS = 2;
const WAIT = { timeout: 30_000, interval: 250 };

const publisher = new OrderSNSPublisher();

const order = (amount: number): OrderEvent => ({
  orderId: randomUUID(),
  customerId: 'customer-123',
  amount,
  status: 'CREATED',
  createdAt: new Date().toISOString(),
});

async function queueAttributes(): Promise<Record<string, string>> {
  const { Attributes } = await sqsClient.send(
    new GetQueueAttributesCommand({ QueueUrl: env.SQS_QUEUE_URL, AttributeNames: ['All'] })
  );
  return Attributes ?? {};
}

const setVisibility = (seconds: number) =>
  sqsClient.send(
    new SetQueueAttributesCommand({
      QueueUrl: env.SQS_QUEUE_URL,
      Attributes: { VisibilityTimeout: String(seconds) },
    })
  );

async function expectMainQueueDrained(): Promise<void> {
  await vi.waitFor(async () => {
    const attributes = await queueAttributes();
    expect(attributes.ApproximateNumberOfMessages).toBe('0');
    expect(attributes.ApproximateNumberOfMessagesNotVisible).toBe('0');
  }, WAIT);
}

/** Polls the DLQ for a message containing `marker`, removing it once found. */
async function takeFromDlq(marker: string): Promise<string> {
  return vi.waitFor(async () => {
    const { Messages = [] } = await sqsClient.send(
      new ReceiveMessageCommand({
        QueueUrl: env.SQS_DLQ_URL,
        MaxNumberOfMessages: 10,
        VisibilityTimeout: 0,
      })
    );
    const match = Messages.find((message) => message.Body?.includes(marker));
    if (!match) throw new Error(`${marker} not in the DLQ yet`);

    await sqsClient.send(
      new DeleteMessageCommand({
        QueueUrl: env.SQS_DLQ_URL,
        ReceiptHandle: match.ReceiptHandle,
      })
    );
    return match.Body!;
  }, WAIT);
}

describe('order flow against the provisioned topology', () => {
  let provisioned: Record<string, string>;

  // Wired like src/index.ts, with spies on both ends of the stack. One worker
  // serves the whole suite: stopping between tests would leave an aborted long
  // poll alive on the server, which claims the next test's message.
  const business = vi.fn(processOrder);
  const { handler: guarded } = withCircuitBreaker(withRetry(business));
  const handler = withIdempotency(guarded, new InMemoryIdempotencyStore());
  const deliveries = vi.fn<OrderHandler>((event) => handler(event));
  const consumer = new OrderSQSConsumer({ handler: deliveries });

  beforeAll(async () => {
    provisioned = await queueAttributes();
    await setVisibility(TEST_VISIBILITY_SECONDS);
    void consumer.start();
  });

  beforeEach(() => {
    business.mockClear();
    deliveries.mockClear();
  });

  afterAll(async () => {
    await consumer.stop();
    await setVisibility(Number(provisioned.VisibilityTimeout));
  });

  it('provisions the visibility timeout and redrive policy the worker relies on', () => {
    expect(provisioned.VisibilityTimeout).toBe('60');
    expect(JSON.parse(provisioned.RedrivePolicy!)).toMatchObject({
      maxReceiveCount: 3,
      deadLetterTargetArn: expect.stringContaining('orders-dlq'),
    });
  });

  it('delivers a published order through SNS to the worker and deletes it', async () => {
    const event = order(99.99);

    await publisher.publishOrderCreated(event);

    await vi.waitFor(() => {
      expect(business).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: event.orderId })
      );
    }, WAIT);
    await expectMainQueueDrained();
  });

  it('moves an order to the DLQ after three failed receives', async () => {
    const event = order(1500);

    await publisher.publishOrderCreated(event);

    const body = await takeFromDlq(event.orderId);

    expect(JSON.parse(JSON.parse(body).Message)).toMatchObject({ orderId: event.orderId });
    expect(deliveries).toHaveBeenCalledTimes(3);
    await expectMainQueueDrained();
  });

  it('moves a malformed payload to the DLQ without reaching the handler', async () => {
    const marker = `malformed-${randomUUID()}`;

    await snsClient.send(
      new PublishCommand({
        TopicArn: env.SNS_TOPIC_ARN,
        Message: JSON.stringify({ orderId: marker }),
      })
    );

    await takeFromDlq(marker);

    expect(deliveries).not.toHaveBeenCalled();
    await expectMainQueueDrained();
  });

  it('processes a re-published order once and still acknowledges both', async () => {
    const event = order(99.99);

    await publisher.publishOrderCreated(event);
    await publisher.publishOrderCreated(event);

    await vi.waitFor(() => expect(deliveries).toHaveBeenCalledTimes(2), WAIT);
    await expectMainQueueDrained();

    expect(business).toHaveBeenCalledOnce();
  });

  it('stops during a real long poll without waiting it out', async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const before = Date.now();
    await consumer.stop();

    expect(Date.now() - before).toBeLessThan(2_000);
  });
});

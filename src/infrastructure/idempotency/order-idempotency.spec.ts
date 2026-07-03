import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SQSClient, DeleteMessageCommand, Message } from '@aws-sdk/client-sqs';
import {
  InMemoryIdempotencyStore,
  withIdempotency,
} from './order-idempotency.js';
import { OrderSQSConsumer } from '../../presentation/sqs.consumer.js';
import type { OrderEvent } from '../../domain/order.schema.js';

const order = (id = randomUUID()): OrderEvent => ({
  orderId: id,
  customerId: 'customer-123',
  amount: 42,
  status: 'CREATED',
  createdAt: new Date().toISOString(),
});

describe('InMemoryIdempotencyStore', () => {
  it('reports membership after add', async () => {
    const store = new InMemoryIdempotencyStore();
    expect(await store.has('a')).toBe(false);
    await store.add('a');
    expect(await store.has('a')).toBe(true);
    expect(await store.has('b')).toBe(false);
  });
});

describe('withIdempotency', () => {
  it('runs the handler and records the order the first time', async () => {
    const store = new InMemoryIdempotencyStore();
    const inner = vi.fn().mockResolvedValue(undefined);
    const handler = withIdempotency(inner, store);

    const o = order();
    await handler(o);

    expect(inner).toHaveBeenCalledTimes(1);
    expect(await store.has(o.orderId)).toBe(true);
  });

  it('skips the handler on a duplicate orderId (no-op)', async () => {
    const store = new InMemoryIdempotencyStore();
    const inner = vi.fn().mockResolvedValue(undefined);
    const handler = withIdempotency(inner, store);

    const o = order();
    await handler(o);
    await expect(handler(o)).resolves.toBeUndefined();

    expect(inner).toHaveBeenCalledTimes(1);
  });

  it('processes distinct orders independently', async () => {
    const store = new InMemoryIdempotencyStore();
    const inner = vi.fn().mockResolvedValue(undefined);
    const handler = withIdempotency(inner, store);

    await handler(order());
    await handler(order());

    expect(inner).toHaveBeenCalledTimes(2);
  });

  it('does NOT record the order when the handler fails (so retry can reprocess)', async () => {
    const store = new InMemoryIdempotencyStore();
    const inner = vi
      .fn()
      .mockRejectedValueOnce(new Error('downstream down'))
      .mockResolvedValueOnce(undefined);
    const handler = withIdempotency(inner, store);

    const o = order();
    await expect(handler(o)).rejects.toThrow('downstream down');
    expect(await store.has(o.orderId)).toBe(false);

    // A later redelivery of the same order is reprocessed, then recorded.
    await expect(handler(o)).resolves.toBeUndefined();
    expect(inner).toHaveBeenCalledTimes(2);
    expect(await store.has(o.orderId)).toBe(true);
  });
});

// End-to-end through the consumer: a redelivered (duplicate) message must be
// acknowledged (deleted) without hitting the downstream a second time.
describe('idempotency through the consumer', () => {
  function sqsMessage(payload: unknown): Message {
    return {
      MessageId: randomUUID(),
      ReceiptHandle: `receipt-${randomUUID()}`,
      Body: JSON.stringify({ Message: JSON.stringify(payload) }),
    };
  }

  it('reprocesses duplicates as a no-op but still deletes them', async () => {
    const send = vi.fn().mockResolvedValue({});
    const client = { send } as unknown as SQSClient;
    const downstream = vi.fn().mockResolvedValue(undefined);
    const handler = withIdempotency(downstream, new InMemoryIdempotencyStore());
    const consumer = new OrderSQSConsumer({ client, handler, queueUrl: 'q' });

    const o = order();
    await consumer.handleMessage(sqsMessage(o));
    await consumer.handleMessage(sqsMessage(o)); // same orderId, redelivered

    expect(downstream).toHaveBeenCalledTimes(1);
    const deletes = send.mock.calls.filter(
      ([cmd]) => cmd instanceof DeleteMessageCommand
    );
    expect(deletes).toHaveLength(2); // both acknowledged/removed from the queue
  });
});

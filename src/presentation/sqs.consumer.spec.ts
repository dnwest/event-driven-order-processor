import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  SQSClient,
  DeleteMessageCommand,
  ReceiveMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { OrderSQSConsumer } from './sqs.consumer.js';
import type { OrderEvent } from '../domain/order.schema.js';

/** Wraps an order payload in the SNS→SQS envelope the consumer expects. */
function sqsMessage(payload: unknown): Message {
  return {
    MessageId: randomUUID(),
    ReceiptHandle: `receipt-${randomUUID()}`,
    Body: JSON.stringify({ Message: JSON.stringify(payload) }),
  };
}

const validOrder = (amount = 99.99): OrderEvent => ({
  orderId: randomUUID(),
  customerId: 'customer-123',
  amount,
  status: 'CREATED',
  createdAt: new Date().toISOString(),
});

function makeClient() {
  const send = vi.fn().mockResolvedValue({});
  return { client: { send } as unknown as SQSClient, send };
}

function fakeMetrics() {
  return {
    messageProcessed: vi.fn(),
    messageFailed: vi.fn(),
    duplicateSkipped: vi.fn(),
    retryScheduled: vi.fn(),
    circuitRejected: vi.fn(),
    circuitStateChanged: vi.fn(),
    queueDepthObserved: vi.fn(),
  };
}

const deleteCalls = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.filter(([cmd]) => cmd instanceof DeleteMessageCommand);

describe('OrderSQSConsumer.handleMessage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes the message once the handler succeeds', async () => {
    const { client, send } = makeClient();
    const handler = vi.fn().mockResolvedValue(undefined);
    const consumer = new OrderSQSConsumer({ client, handler, queueUrl: 'q' });

    const order = validOrder();
    await consumer.handleMessage(sqsMessage(order));

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: order.orderId })
    );
    expect(deleteCalls(send)).toHaveLength(1);
  });

  it('does NOT delete when the payload fails validation', async () => {
    const { client, send } = makeClient();
    const handler = vi.fn().mockResolvedValue(undefined);
    const consumer = new OrderSQSConsumer({ client, handler, queueUrl: 'q' });

    await consumer.handleMessage(sqsMessage({ orderId: 'not-a-uuid' }));

    expect(handler).not.toHaveBeenCalled();
    expect(deleteCalls(send)).toHaveLength(0);
  });

  it('does NOT delete when the downstream handler throws (leaves it for redrive/DLQ)', async () => {
    const { client, send } = makeClient();
    const handler = vi.fn().mockRejectedValue(new Error('downstream down'));
    const consumer = new OrderSQSConsumer({ client, handler, queueUrl: 'q' });

    await consumer.handleMessage(sqsMessage(validOrder(1500)));

    expect(handler).toHaveBeenCalledOnce();
    expect(deleteCalls(send)).toHaveLength(0);
  });

  it('records a processed message with its duration', async () => {
    const { client } = makeClient();
    const metrics = fakeMetrics();
    const consumer = new OrderSQSConsumer({
      client,
      handler: vi.fn().mockResolvedValue(undefined),
      queueUrl: 'q',
      metrics,
    });

    await consumer.handleMessage(sqsMessage(validOrder()));

    expect(metrics.messageProcessed).toHaveBeenCalledOnce();
    expect(metrics.messageProcessed.mock.calls[0][0]).toBeGreaterThanOrEqual(0);
    expect(metrics.messageFailed).not.toHaveBeenCalled();
  });

  it('separates validation failures from downstream failures', async () => {
    const { client } = makeClient();
    const metrics = fakeMetrics();
    const handler = vi.fn().mockRejectedValue(new Error('downstream down'));
    const consumer = new OrderSQSConsumer({ client, handler, queueUrl: 'q', metrics });

    await consumer.handleMessage(sqsMessage({ orderId: 'not-a-uuid' }));
    await consumer.handleMessage(sqsMessage(validOrder(1500)));

    expect(metrics.messageFailed.mock.calls.map(([reason]) => reason)).toEqual([
      'validation',
      'downstream',
    ]);
  });

  it('does not throw on malformed (non-JSON) message bodies', async () => {
    const { client, send } = makeClient();
    const consumer = new OrderSQSConsumer({ client, queueUrl: 'q' });

    await expect(
      consumer.handleMessage({ MessageId: 'x', Body: 'not json' })
    ).resolves.toBeUndefined();
    expect(deleteCalls(send)).toHaveLength(0);
  });
});

describe('OrderSQSConsumer shutdown', () => {
  const receiveCalls = (send: ReturnType<typeof vi.fn>) =>
    send.mock.calls.filter(([cmd]) => cmd instanceof ReceiveMessageCommand);

  /** A long poll that only ends when the caller aborts it, like the real one. */
  const longPoll = (_cmd: unknown, options?: { abortSignal?: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      options?.abortSignal?.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError'))
      );
    });

  it('aborts the in-progress long poll instead of waiting it out', async () => {
    const send = vi.fn(longPoll);
    const consumer = new OrderSQSConsumer({
      client: { send } as unknown as SQSClient,
      handler: vi.fn(),
      queueUrl: 'q',
    });

    const started = consumer.start();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    await consumer.stop();
    await started;

    expect(receiveCalls(send)).toHaveLength(1);
  });

  it('finishes the in-flight message and leaves the rest of the batch', async () => {
    let finishHandler!: () => void;
    const handler = vi.fn(() => new Promise<void>((r) => (finishHandler = r)));
    const batch = [sqsMessage(validOrder()), sqsMessage(validOrder())];
    const send = vi.fn(async (cmd: unknown) =>
      cmd instanceof ReceiveMessageCommand ? { Messages: batch } : {}
    );
    const consumer = new OrderSQSConsumer({
      client: { send } as unknown as SQSClient,
      handler,
      queueUrl: 'q',
    });

    void consumer.start();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());

    const stopped = consumer.stop();
    finishHandler();
    await stopped;

    expect(handler).toHaveBeenCalledOnce();
    expect(deleteCalls(send)).toHaveLength(1);
    expect(receiveCalls(send)).toHaveLength(1);
  });

  it('does not sit out the error backoff when stopped', async () => {
    const send = vi.fn().mockRejectedValue(new Error('sqs down'));
    const consumer = new OrderSQSConsumer({
      client: { send } as unknown as SQSClient,
      handler: vi.fn(),
      queueUrl: 'q',
    });

    void consumer.start();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());

    const before = Date.now();
    await consumer.stop();

    expect(Date.now() - before).toBeLessThan(1_000);
  });

  it('resolves stop() when the consumer never started', async () => {
    const { client } = makeClient();
    const consumer = new OrderSQSConsumer({ client, handler: vi.fn(), queueUrl: 'q' });

    await expect(consumer.stop()).resolves.toBeUndefined();
  });
});

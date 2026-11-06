import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { sqsClient } from '../infrastructure/aws/sqs.client.js';
import { env } from '../config/env.js';
import { noopMetrics, type MetricsSink } from '../infrastructure/observability/metrics.js';
import { logger } from '../infrastructure/observability/logger.js';
import { OrderEventSchema, type OrderEvent } from '../domain/order.schema.js';
import { processOrder, type OrderHandler } from '../domain/process-order.js';

const DEFAULT_QUEUE_URL = env.SQS_QUEUE_URL;

export interface ConsumerOptions {
  client?: SQSClient;
  queueUrl?: string;
  handler?: OrderHandler;
  metrics?: MetricsSink;
}

export class OrderSQSConsumer {
  private client: SQSClient;
  private queueUrl: string;
  private handler: OrderHandler;
  private metrics: MetricsSink;
  private running = false;
  private abort = new AbortController();
  private loop: Promise<void> = Promise.resolve();

  constructor(options: ConsumerOptions = {}) {
    this.client = options.client ?? sqsClient;
    this.queueUrl = options.queueUrl ?? DEFAULT_QUEUE_URL;
    this.handler = options.handler ?? processOrder;
    this.metrics = options.metrics ?? noopMetrics;
  }

  start(): Promise<void> {
    this.running = true;
    this.abort = new AbortController();
    logger.info({ queueUrl: this.queueUrl }, 'Starting SQS Consumer');

    this.loop = this.poll();
    return this.loop;
  }

  /**
   * Stops polling and resolves once the loop has exited.
   *
   * The long poll is aborted, but the message being handled runs to completion,
   * delete included. The rest of its batch is left alone and SQS makes it
   * visible again after the visibility timeout.
   */
  async stop(): Promise<void> {
    this.running = false;
    this.abort.abort();
    await this.loop;
  }

  // Messages are handled one at a time on purpose: in parallel, a duplicate
  // inside one batch would pass the idempotency check twice. The worst case for
  // a batch is therefore 10 x the breaker timeout, which is why the queue's
  // visibility timeout has to stay well above 30s.
  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const result = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20,
            MessageAttributeNames: ['All'],
          }),
          { abortSignal: this.abort.signal }
        );

        if (result.Messages?.length) {
          logger.debug({ count: result.Messages.length }, 'Messages received');

          for (const message of result.Messages) {
            if (!this.running) break;
            await this.handleMessage(message);
          }
        }
      } catch (error) {
        if (!this.running) break;
        logger.error({ error }, 'Error receiving messages');
        await this.sleep(5000);
      }
    }
  }

  /**
   * Processes a single SQS message end-to-end. Public so it can be unit-tested
   * in isolation without driving the polling loop.
   *
   * The message is only deleted when both validation and the downstream handler
   * succeed. On any failure the message is left on the queue so SQS redelivery
   * (and eventually the DLQ via RedrivePolicy) can take over.
   */
  async handleMessage(message: Message): Promise<void> {
    const startedAt = Date.now();
    let orderEvent: OrderEvent;

    // Parsing is separated from processing so the two failure modes are
    // distinguishable: a malformed payload will never succeed on redelivery,
    // while a downstream failure is expected to.
    try {
      const snsEnvelope = JSON.parse(message.Body!);
      orderEvent = OrderEventSchema.parse(JSON.parse(snsEnvelope.Message));
    } catch (error) {
      logger.error(
        { error, messageId: message.MessageId },
        'Failed to process message'
      );
      this.metrics.messageFailed('validation');
      return;
    }

    try {
      logger.info({ orderId: orderEvent.orderId }, 'Processing order');

      await this.handler(orderEvent);

      await this.client.send(
        new DeleteMessageCommand({
          QueueUrl: this.queueUrl,
          ReceiptHandle: message.ReceiptHandle,
        })
      );

      logger.info(
        { orderId: orderEvent.orderId },
        'Order processed and message deleted'
      );
      this.metrics.messageProcessed((Date.now() - startedAt) / 1000);
    } catch (error) {
      logger.error(
        { error, messageId: message.MessageId },
        'Failed to process message'
      );
      this.metrics.messageFailed('downstream');
    }
  }

  /** Resolves early on stop(), so shutdown never waits out the error backoff. */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abort.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
  }
}

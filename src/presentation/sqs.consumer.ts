import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { sqsClient } from '../infrastructure/aws/sqs.client.js';
import { logger } from '../infrastructure/observability/logger.js';
import { OrderEventSchema } from '../domain/order.schema.js';
import { processOrder, type OrderHandler } from '../domain/process-order.js';

const DEFAULT_QUEUE_URL =
  process.env.SQS_QUEUE_URL || 'http://localhost:4566/000000000000/orders-queue';

export interface ConsumerOptions {
  client?: SQSClient;
  queueUrl?: string;
  handler?: OrderHandler;
}

export class OrderSQSConsumer {
  private client: SQSClient;
  private queueUrl: string;
  private handler: OrderHandler;
  private running = false;

  constructor(options: ConsumerOptions = {}) {
    this.client = options.client ?? sqsClient;
    this.queueUrl = options.queueUrl ?? DEFAULT_QUEUE_URL;
    this.handler = options.handler ?? processOrder;
  }

  async start(): Promise<void> {
    this.running = true;
    logger.info({ queueUrl: this.queueUrl }, 'Starting SQS Consumer');

    while (this.running) {
      try {
        const result = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: this.queueUrl,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20,
            MessageAttributeNames: ['All'],
          })
        );

        if (result.Messages?.length) {
          logger.debug({ count: result.Messages.length }, 'Messages received');

          for (const message of result.Messages) {
            await this.handleMessage(message);
          }
        }
      } catch (error) {
        logger.error({ error }, 'Error receiving messages');
        await this.sleep(5000);
      }
    }
  }

  /** Stops the polling loop after the current iteration. */
  stop(): void {
    this.running = false;
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
    try {
      const snsEnvelope = JSON.parse(message.Body!);
      const payload = JSON.parse(snsEnvelope.Message);
      const orderEvent = OrderEventSchema.parse(payload);

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
    } catch (error) {
      logger.error(
        { error, messageId: message.MessageId },
        'Failed to process message'
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

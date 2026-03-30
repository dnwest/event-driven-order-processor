import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { sqsClient } from '../infrastructure/aws/sqs.client.js';
import { logger } from '../infrastructure/observability/logger.js';
import { OrderEventSchema, type OrderEvent } from '../domain/order.schema.js';

const QUEUE_URL = process.env.SQS_QUEUE_URL || 'http://localhost:4566/000000000000/orders-queue';

export class OrderSQSConsumer {
  private client: SQSClient;

  constructor(client: SQSClient = sqsClient) {
    this.client = client;
  }

  async start(): Promise<void> {
    logger.info({ queueUrl: QUEUE_URL }, 'Starting SQS Consumer');

    while (true) {
      try {
        const result = await this.client.send(
          new ReceiveMessageCommand({
            QueueUrl: QUEUE_URL,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20,
            MessageAttributeNames: ['All'],
          })
        );

        if (result.Messages?.length) {
          logger.debug({ count: result.Messages.length }, 'Messages received');

          for (const message of result.Messages) {
            await this.processMessage(message);
          }
        }
      } catch (error) {
        logger.error({ error }, 'Error receiving messages');
        await this.sleep(5000);
      }
    }
  }

  private async processMessage(message: Message): Promise<void> {
    try {
      const snsEnvelope = JSON.parse(message.Body!);
      const payload = JSON.parse(snsEnvelope.Message);
      const orderEvent = OrderEventSchema.parse(payload);

      logger.info({ orderId: orderEvent.orderId }, 'Processing order');

      await this.processOrder(orderEvent);

      await this.client.send(
        new DeleteMessageCommand({
          QueueUrl: QUEUE_URL,
          ReceiptHandle: message.ReceiptHandle,
        })
      );

      logger.info({ orderId: orderEvent.orderId }, 'Order processed and message deleted');
    } catch (error) {
      logger.error(
        { error, messageId: message.MessageId },
        'Failed to process message'
      );
    }
  }

  private async processOrder(order: OrderEvent): Promise<void> {
    logger.debug({ order }, 'Business logic processing');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

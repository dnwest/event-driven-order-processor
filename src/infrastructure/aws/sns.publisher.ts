import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { snsClient } from './sns.client.js';
import { logger } from '../observability/logger.js';
import { env } from '../../config/env.js';
import type { OrderEvent } from '../../domain/order.schema.js';

const TOPIC_ARN = env.SNS_TOPIC_ARN;

export class OrderSNSPublisher {
  private client: SNSClient;

  constructor(client: SNSClient = snsClient) {
    this.client = client;
  }

  async publishOrderCreated(order: OrderEvent): Promise<void> {
    await this.client.send(
      new PublishCommand({
        TopicArn: TOPIC_ARN,
        Message: JSON.stringify(order),
        MessageAttributes: {
          eventType: { DataType: 'String', StringValue: 'ORDER_CREATED' },
        },
      })
    );
    logger.info({ orderId: order.orderId }, 'Order event published to SNS');
  }
}

import { GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { logger } from './logger.js';
import type { MetricsSink, QueueLabel } from './metrics.js';

export interface QueueDepthOptions {
  client: SQSClient;
  metrics: MetricsSink;
  queues: Array<{ label: QueueLabel; url: string }>;
  intervalMs?: number;
}

export interface QueueDepthPoller {
  /** Polls once. Call it after starting to seed the gauges before the first tick. */
  poll(): Promise<void>;
  stop(): void;
}

/**
 * Publishes queue and DLQ depth as gauges.
 *
 * SQS does not push these, and the consumer only ever sees the messages it
 * receives — so a growing backlog or a filling DLQ is invisible without an
 * explicit poll. `ApproximateNumberOfMessages` is eventually consistent, which
 * is why the alert thresholds in the README are stated as sustained levels
 * rather than single readings.
 */
export function startQueueDepthPoller(options: QueueDepthOptions): QueueDepthPoller {
  const { client, metrics, queues, intervalMs = 30_000 } = options;

  const poll = async () => {
    for (const queue of queues) {
      try {
        const result = await client.send(
          new GetQueueAttributesCommand({
            QueueUrl: queue.url,
            AttributeNames: [
              'ApproximateNumberOfMessages',
              'ApproximateNumberOfMessagesNotVisible',
            ],
          })
        );

        metrics.queueDepthObserved(
          queue.label,
          Number(result.Attributes?.ApproximateNumberOfMessages ?? 0),
          Number(result.Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0)
        );
      } catch (error) {
        logger.warn({ error, queue: queue.label }, 'Failed to read queue depth');
      }
    }
  };

  const timer = setInterval(poll, intervalMs);
  timer.unref?.();

  return { poll, stop: () => clearInterval(timer) };
}

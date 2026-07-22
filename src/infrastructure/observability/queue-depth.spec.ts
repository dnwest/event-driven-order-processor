import { describe, it, expect, vi } from 'vitest';
import { GetQueueAttributesCommand, type SQSClient } from '@aws-sdk/client-sqs';
import { startQueueDepthPoller } from './queue-depth.js';
import { noopMetrics, type MetricsSink } from './metrics.js';

function fakeMetrics(): MetricsSink & { queueDepthObserved: ReturnType<typeof vi.fn> } {
  return { ...noopMetrics, queueDepthObserved: vi.fn() };
}

const queues = [
  { label: 'main' as const, url: 'main-url' },
  { label: 'dlq' as const, url: 'dlq-url' },
];

describe('startQueueDepthPoller', () => {
  it('reports visible and in-flight depth for every queue', async () => {
    const send = vi.fn().mockResolvedValue({
      Attributes: {
        ApproximateNumberOfMessages: '7',
        ApproximateNumberOfMessagesNotVisible: '2',
      },
    });
    const metrics = fakeMetrics();

    const poller = startQueueDepthPoller({
      client: { send } as unknown as SQSClient,
      metrics,
      queues,
    });
    await poller.poll();
    poller.stop();

    expect(send.mock.calls[0][0]).toBeInstanceOf(GetQueueAttributesCommand);
    expect(metrics.queueDepthObserved).toHaveBeenCalledWith('main', 7, 2);
    expect(metrics.queueDepthObserved).toHaveBeenCalledWith('dlq', 7, 2);
  });

  it('treats missing attributes as zero rather than NaN', async () => {
    const send = vi.fn().mockResolvedValue({});
    const metrics = fakeMetrics();

    const poller = startQueueDepthPoller({
      client: { send } as unknown as SQSClient,
      metrics,
      queues: [queues[0]],
    });
    await poller.poll();
    poller.stop();

    expect(metrics.queueDepthObserved).toHaveBeenCalledWith('main', 0, 0);
  });

  // A failing gauge poll must not take the worker down with it.
  it('survives an SQS error and still polls the remaining queues', async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error('sqs unavailable'))
      .mockResolvedValue({ Attributes: { ApproximateNumberOfMessages: '1' } });
    const metrics = fakeMetrics();

    const poller = startQueueDepthPoller({
      client: { send } as unknown as SQSClient,
      metrics,
      queues,
    });
    await expect(poller.poll()).resolves.toBeUndefined();
    poller.stop();

    expect(metrics.queueDepthObserved).toHaveBeenCalledTimes(1);
    expect(metrics.queueDepthObserved).toHaveBeenCalledWith('dlq', 1, 0);
  });
});

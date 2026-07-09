import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { withRetry } from './order-retry.js';
import type { OrderEvent } from '../../domain/order.schema.js';

const order = (): OrderEvent => ({
  orderId: randomUUID(),
  customerId: 'customer-123',
  amount: 42,
  status: 'CREATED',
  createdAt: new Date().toISOString(),
});

// A sleep spy that resolves immediately, so tests assert the delays without waiting.
const fakeSleep = () => vi.fn().mockResolvedValue(undefined);
const delays = (sleep: ReturnType<typeof fakeSleep>) =>
  sleep.mock.calls.map(([ms]) => ms);

describe('withRetry', () => {
  it('does not retry when the handler succeeds on the first attempt', async () => {
    const sleep = fakeSleep();
    const inner = vi.fn().mockResolvedValue(undefined);
    const handler = withRetry(inner, { sleep });

    await handler(order());

    expect(inner).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries a transient failure with exponential backoff, then succeeds', async () => {
    const sleep = fakeSleep();
    const inner = vi
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(undefined);
    const handler = withRetry(inner, {
      sleep,
      random: () => 1, // full jitter pinned to its max → deterministic delays
      maxRetries: 5,
      baseDelayMs: 100,
      maxDelayMs: 2_000,
    });

    await handler(order());

    expect(inner).toHaveBeenCalledTimes(3);
    expect(delays(sleep)).toEqual([100, 200]); // base * 2**attempt
  });

  it('caps the backoff at maxDelayMs', async () => {
    const sleep = fakeSleep();
    const inner = vi.fn().mockRejectedValue(new Error('down'));
    const handler = withRetry(inner, {
      sleep,
      random: () => 1,
      maxRetries: 4,
      baseDelayMs: 100,
      maxDelayMs: 250,
    });

    await expect(handler(order())).rejects.toThrow('down');
    expect(delays(sleep)).toEqual([100, 200, 250, 250]); // capped once past 250
  });

  it('applies jitter within [0, cap]', async () => {
    const sleep = fakeSleep();
    const inner = vi
      .fn()
      .mockRejectedValueOnce(new Error('blip'))
      .mockResolvedValueOnce(undefined);
    const handler = withRetry(inner, { sleep, random: () => 0.5, baseDelayMs: 100 });

    await handler(order());

    expect(sleep).toHaveBeenCalledWith(50); // 0.5 * cap(100)
  });

  it('gives up after maxRetries and rethrows the last error', async () => {
    const sleep = fakeSleep();
    const inner = vi.fn().mockRejectedValue(new Error('still down'));
    const handler = withRetry(inner, { sleep, maxRetries: 2 });

    await expect(handler(order())).rejects.toThrow('still down');
    expect(inner).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a non-retryable (permanent) error — fails fast', async () => {
    const sleep = fakeSleep();
    const permanent = new Error('bad input');
    const inner = vi.fn().mockRejectedValue(permanent);
    const handler = withRetry(inner, {
      sleep,
      isRetryable: (e) => e !== permanent,
    });

    await expect(handler(order())).rejects.toThrow('bad input');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});

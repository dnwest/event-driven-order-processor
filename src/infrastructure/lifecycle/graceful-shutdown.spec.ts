import { describe, it, expect, vi } from 'vitest';
import { createShutdown } from './graceful-shutdown.js';

const step = (name: string, run: () => Promise<void> | void = () => undefined) => ({
  name,
  run: vi.fn(run),
});

describe('createShutdown', () => {
  it('runs the steps in order, then exits 0', async () => {
    const order: string[] = [];
    const exit = vi.fn();
    const shutdown = createShutdown({
      steps: [
        step('consumer', () => void order.push('consumer')),
        step('redis', () => void order.push('redis')),
      ],
      timeoutMs: 1_000,
      exit,
    });

    await shutdown('SIGTERM');

    expect(order).toEqual(['consumer', 'redis']);
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('waits for a step to finish before starting the next one', async () => {
    let release!: () => void;
    const first = step('consumer', () => new Promise<void>((r) => (release = r)));
    const second = step('redis');
    const shutdown = createShutdown({
      steps: [first, second],
      timeoutMs: 1_000,
      exit: vi.fn(),
    });

    const done = shutdown('SIGTERM');
    await Promise.resolve();
    expect(second.run).not.toHaveBeenCalled();

    release();
    await done;
    expect(second.run).toHaveBeenCalledOnce();
  });

  it('ignores a second signal while already shutting down', async () => {
    const consumer = step('consumer');
    const exit = vi.fn();
    const shutdown = createShutdown({ steps: [consumer], timeoutMs: 1_000, exit });

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);

    expect(consumer.run).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it('still runs the remaining steps when one fails, and exits 1', async () => {
    const redis = step('redis');
    const exit = vi.fn();
    const shutdown = createShutdown({
      steps: [step('metrics', () => Promise.reject(new Error('boom'))), redis],
      timeoutMs: 1_000,
      exit,
    });

    await shutdown('SIGTERM');

    expect(redis.run).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('forces exit 1 when a step outlives the timeout', async () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      const shutdown = createShutdown({
        steps: [step('consumer', () => new Promise<void>(() => undefined))],
        timeoutMs: 1_000,
        exit,
      });

      void shutdown('SIGTERM');
      await vi.advanceTimersByTimeAsync(1_000);

      expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

import { describe, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RedisIdempotencyStore, type RedisCommands } from './redis-idempotency-store.js';
import { withIdempotency } from './order-idempotency.js';
import type { OrderEvent } from '../../domain/order.schema.js';

/** Minimal stand-in for Redis: a Map plus the two commands the store uses. */
function fakeRedis() {
  const keys = new Map<string, { value: string; ttlSeconds: number }>();

  const client: RedisCommands = {
    exists: vi.fn(async (key) => (keys.has(key) ? 1 : 0)),
    set: vi.fn(async (key, value, _mode, ttlSeconds) => {
      keys.set(key, { value, ttlSeconds });
      return 'OK';
    }),
  };

  return { client, keys };
}

const order = (): OrderEvent => ({
  orderId: randomUUID(),
  customerId: 'customer-123',
  amount: 99.99,
  status: 'CREATED',
  createdAt: new Date().toISOString(),
});

describe('RedisIdempotencyStore', () => {
  it('reports an unknown order as not seen', async () => {
    const { client } = fakeRedis();
    const store = new RedisIdempotencyStore({ client });

    expect(await store.has('order-1')).toBe(false);
  });

  it('remembers an order under a namespaced key with a TTL', async () => {
    const { client, keys } = fakeRedis();
    const store = new RedisIdempotencyStore({ client, ttlSeconds: 3600 });

    await store.add('order-1');

    expect(await store.has('order-1')).toBe(true);
    expect(keys.get('order:processed:order-1')).toEqual({ value: '1', ttlSeconds: 3600 });
  });

  it('keeps different orders independent', async () => {
    const { client } = fakeRedis();
    const store = new RedisIdempotencyStore({ client });

    await store.add('order-1');

    expect(await store.has('order-2')).toBe(false);
  });

  // The point of the whole item: two workers, one shared store.
  it('deduplicates across separate store instances sharing a backend', async () => {
    const { client } = fakeRedis();
    const workerA = withIdempotency(
      vi.fn().mockResolvedValue(undefined),
      new RedisIdempotencyStore({ client })
    );
    const handlerB = vi.fn().mockResolvedValue(undefined);
    const workerB = withIdempotency(handlerB, new RedisIdempotencyStore({ client }));

    const event = order();
    await workerA(event);
    await workerB(event);

    expect(handlerB).not.toHaveBeenCalled();
  });

  it('does not record an order whose handler failed, so it is reprocessed', async () => {
    const { client } = fakeRedis();
    const store = new RedisIdempotencyStore({ client });
    const handler = vi.fn().mockRejectedValueOnce(new Error('downstream down'));
    const guarded = withIdempotency(handler, store);

    const event = order();
    await expect(guarded(event)).rejects.toThrow('downstream down');

    expect(await store.has(event.orderId)).toBe(false);
  });

  it('surfaces a store outage instead of processing an order it cannot dedupe', async () => {
    const client: RedisCommands = {
      exists: vi.fn().mockRejectedValue(new Error('redis unreachable')),
      set: vi.fn(),
    };
    const handler = vi.fn();
    const guarded = withIdempotency(handler, new RedisIdempotencyStore({ client }));

    await expect(guarded(order())).rejects.toThrow('redis unreachable');
    expect(handler).not.toHaveBeenCalled();
  });
});

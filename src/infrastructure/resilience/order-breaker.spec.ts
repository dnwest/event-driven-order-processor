import { describe, it, expect, vi, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import type CircuitBreaker from 'opossum';
import { withCircuitBreaker } from './order-breaker.js';
import type { OrderEvent } from '../../domain/order.schema.js';

const order = (): OrderEvent => ({
  orderId: randomUUID(),
  customerId: 'customer-123',
  amount: 42,
  status: 'CREATED',
  createdAt: new Date().toISOString(),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Track breakers so their internal timers are torn down between tests.
const breakers: CircuitBreaker[] = [];
afterEach(() => {
  while (breakers.length) breakers.pop()?.shutdown();
});

function build(impl: (o: OrderEvent) => Promise<void>, resetTimeout = 10_000) {
  const wrapped = withCircuitBreaker(impl, {
    volumeThreshold: 3,
    errorThresholdPercentage: 50,
    resetTimeout,
  });
  breakers.push(wrapped.breaker);
  return wrapped;
}

describe('withCircuitBreaker', () => {
  it('opens after the configured number of consecutive downstream failures', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('downstream down'));
    const { handler, breaker } = build(impl);

    for (let i = 0; i < 3; i++) {
      await expect(handler(order())).rejects.toThrow();
    }

    expect(breaker.opened).toBe(true);
    expect(impl).toHaveBeenCalledTimes(3);
  });

  it('short-circuits while open — the downstream handler is not invoked', async () => {
    const impl = vi.fn().mockRejectedValue(new Error('downstream down'));
    const { handler, breaker } = build(impl);

    for (let i = 0; i < 3; i++) {
      await expect(handler(order())).rejects.toThrow();
    }
    expect(breaker.opened).toBe(true);

    const callsWhenOpened = impl.mock.calls.length;
    await expect(handler(order())).rejects.toThrow(/breaker is open|open/i);

    // No new downstream attempt was made.
    expect(impl.mock.calls.length).toBe(callsWhenOpened);
  });

  it('recovers to closed via half-open once the dependency is healthy again', async () => {
    let healthy = false;
    const impl = vi.fn(async () => {
      if (!healthy) throw new Error('downstream down');
    });
    const { handler, breaker } = build(impl, 50);

    for (let i = 0; i < 3; i++) {
      await expect(handler(order())).rejects.toThrow();
    }
    expect(breaker.opened).toBe(true);

    // Dependency recovers; wait past resetTimeout so the breaker half-opens.
    healthy = true;
    await sleep(80);

    await expect(handler(order())).resolves.toBeUndefined();
    expect(breaker.closed).toBe(true);
  });

  it('never trips on a healthy dependency', async () => {
    const impl = vi.fn().mockResolvedValue(undefined);
    const { handler, breaker } = build(impl);

    for (let i = 0; i < 10; i++) {
      await expect(handler(order())).resolves.toBeUndefined();
    }

    expect(breaker.closed).toBe(true);
    expect(breaker.opened).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { processOrder } from './process-order.js';
import type { OrderEvent } from './order.schema.js';

const order = (amount: number): OrderEvent => ({
  orderId: randomUUID(),
  customerId: 'customer-123',
  amount,
  status: 'CREATED',
  createdAt: new Date().toISOString(),
});

describe('processOrder', () => {
  it('resolves for a normal-value order', async () => {
    await expect(processOrder(order(99.99))).resolves.toBeUndefined();
  });

  it('throws (simulated downstream failure) for a high-value order', async () => {
    await expect(processOrder(order(1500))).rejects.toThrow(
      /simulated database failure/i
    );
  });

  it('treats the 1000 boundary as still processable', async () => {
    await expect(processOrder(order(1000))).resolves.toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { OrderEventSchema } from './order.schema.js';

const validOrder = () => ({
  orderId: randomUUID(),
  customerId: 'customer-123',
  amount: 99.99,
  status: 'CREATED',
  createdAt: new Date().toISOString(),
});

describe('OrderEventSchema', () => {
  it('accepts a well-formed order event', () => {
    const order = validOrder();
    expect(OrderEventSchema.parse(order)).toEqual(order);
  });

  it('rejects a non-uuid orderId', () => {
    expect(() =>
      OrderEventSchema.parse({ ...validOrder(), orderId: 'not-a-uuid' })
    ).toThrow();
  });

  it('rejects a non-positive amount', () => {
    expect(() =>
      OrderEventSchema.parse({ ...validOrder(), amount: 0 })
    ).toThrow();
    expect(() =>
      OrderEventSchema.parse({ ...validOrder(), amount: -5 })
    ).toThrow();
  });

  it('rejects a non-ISO createdAt', () => {
    expect(() =>
      OrderEventSchema.parse({ ...validOrder(), createdAt: '2026-07-03' })
    ).toThrow();
  });

  it('rejects a missing required field', () => {
    const { customerId, ...withoutCustomer } = validOrder();
    void customerId;
    expect(() => OrderEventSchema.parse(withoutCustomer)).toThrow();
  });
});

import { z } from 'zod';

export const OrderEventSchema = z.object({
  orderId: z.string().uuid(),
  customerId: z.string(),
  amount: z.number().positive(),
  status: z.string(),
  createdAt: z.string().datetime(),
});

export type OrderEvent = z.infer<typeof OrderEventSchema>;

import { describe, it, expect } from 'vitest';
import type { Registry } from 'prom-client';
import { createPrometheusMetrics } from './metrics.js';

async function sampleOf(registry: Registry, name: string) {
  const metric = await registry.getSingleMetric(name)!.get();
  return metric.values;
}

describe('createPrometheusMetrics', () => {
  it('exposes processed orders in the scrape output', async () => {
    const { sink, registry } = createPrometheusMetrics();

    sink.messageProcessed(0.2);
    sink.messageProcessed(0.4);

    const scrape = await registry.metrics();
    expect(scrape).toContain('orders_processed_total 2');
  });

  it('labels failures by reason so validation and downstream are separable', async () => {
    const { sink, registry } = createPrometheusMetrics();

    sink.messageFailed('validation');
    sink.messageFailed('downstream');
    sink.messageFailed('downstream');

    const values = await sampleOf(registry, 'orders_failed_total');
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labels: { reason: 'validation' }, value: 1 }),
        expect.objectContaining({ labels: { reason: 'downstream' }, value: 2 }),
      ])
    );
  });

  it('starts closed and maps every breaker state to a distinct value', async () => {
    const { sink, registry } = createPrometheusMetrics();

    expect((await sampleOf(registry, 'orders_circuit_state'))[0].value).toBe(0);

    sink.circuitStateChanged('open');
    expect((await sampleOf(registry, 'orders_circuit_state'))[0].value).toBe(2);

    sink.circuitStateChanged('half_open');
    expect((await sampleOf(registry, 'orders_circuit_state'))[0].value).toBe(1);
  });

  it('tracks each queue depth separately', async () => {
    const { sink, registry } = createPrometheusMetrics();

    sink.queueDepthObserved('main', 12, 3);
    sink.queueDepthObserved('dlq', 1, 0);

    const visible = await sampleOf(registry, 'orders_queue_messages_visible');
    expect(visible).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labels: { queue: 'main' }, value: 12 }),
        expect.objectContaining({ labels: { queue: 'dlq' }, value: 1 }),
      ])
    );
  });

  it('keeps registries independent, so counters cannot leak between instances', async () => {
    const first = createPrometheusMetrics();
    const second = createPrometheusMetrics();

    first.sink.messageProcessed(0.1);

    expect(await second.registry.metrics()).toContain('orders_processed_total 0');
  });
});

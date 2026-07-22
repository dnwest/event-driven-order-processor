import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/** Why a message did not make it through, kept low-cardinality for labels. */
export type FailureReason = 'validation' | 'downstream';

export type BreakerState = 'closed' | 'half_open' | 'open';

export type QueueLabel = 'main' | 'dlq';

/**
 * Everything the pipeline reports, as a narrow port.
 *
 * The layers depend on this instead of on Prometheus, so their unit tests can
 * assert what was recorded with a plain object and no registry to reset.
 */
export interface MetricsSink {
  messageProcessed(durationSeconds: number): void;
  messageFailed(reason: FailureReason): void;
  duplicateSkipped(): void;
  retryScheduled(): void;
  circuitRejected(): void;
  circuitStateChanged(state: BreakerState): void;
  queueDepthObserved(queue: QueueLabel, visible: number, inFlight: number): void;
}

/** No-op sink, so metrics stay opt-in and tests can ignore them. */
export const noopMetrics: MetricsSink = {
  messageProcessed: () => {},
  messageFailed: () => {},
  duplicateSkipped: () => {},
  retryScheduled: () => {},
  circuitRejected: () => {},
  circuitStateChanged: () => {},
  queueDepthObserved: () => {},
};

const BREAKER_STATE_VALUES: Record<BreakerState, number> = {
  closed: 0,
  half_open: 1,
  open: 2,
};

export interface PrometheusMetrics {
  sink: MetricsSink;
  registry: Registry;
}

export function createPrometheusMetrics(): PrometheusMetrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const processed = new Counter({
    name: 'orders_processed_total',
    help: 'Orders processed successfully and acknowledged to SQS.',
    registers: [registry],
  });

  const failed = new Counter({
    name: 'orders_failed_total',
    help: 'Messages left on the queue for redrive, by failure reason.',
    labelNames: ['reason'] as const,
    registers: [registry],
  });

  const duplicates = new Counter({
    name: 'orders_duplicate_total',
    help: 'Re-delivered orders skipped by the idempotency layer.',
    registers: [registry],
  });

  const retries = new Counter({
    name: 'orders_retry_total',
    help: 'In-process retry attempts after a transient downstream failure.',
    registers: [registry],
  });

  const circuitRejections = new Counter({
    name: 'orders_circuit_rejected_total',
    help: 'Calls short-circuited while the breaker was open.',
    registers: [registry],
  });

  const circuitState = new Gauge({
    name: 'orders_circuit_state',
    help: 'Circuit breaker state: 0 closed, 1 half-open, 2 open.',
    registers: [registry],
  });

  const duration = new Histogram({
    name: 'order_processing_duration_seconds',
    help: 'Wall time from message received to acknowledged.',
    // Bucketed around the breaker's 3s timeout, so the histogram shows calls
    // approaching it rather than lumping everything into +Inf.
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5],
    registers: [registry],
  });

  const queueVisible = new Gauge({
    name: 'orders_queue_messages_visible',
    help: 'Approximate messages waiting to be received.',
    labelNames: ['queue'] as const,
    registers: [registry],
  });

  const queueInFlight = new Gauge({
    name: 'orders_queue_messages_in_flight',
    help: 'Approximate messages received but not yet deleted.',
    labelNames: ['queue'] as const,
    registers: [registry],
  });

  circuitState.set(BREAKER_STATE_VALUES.closed);

  const sink: MetricsSink = {
    messageProcessed(durationSeconds) {
      processed.inc();
      duration.observe(durationSeconds);
    },
    messageFailed(reason) {
      failed.inc({ reason });
    },
    duplicateSkipped: () => duplicates.inc(),
    retryScheduled: () => retries.inc(),
    circuitRejected: () => circuitRejections.inc(),
    circuitStateChanged: (state) => circuitState.set(BREAKER_STATE_VALUES[state]),
    queueDepthObserved(queue, visible, inFlight) {
      queueVisible.set({ queue }, visible);
      queueInFlight.set({ queue }, inFlight);
    },
  };

  return { sink, registry };
}

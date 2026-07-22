# 📨 Event-Driven Order Processor

> An asynchronous order-processing worker demonstrating core Event-Driven Architecture (EDA) patterns — SNS fan-out, SQS consumption, and Dead Letter Queues — with Node.js, AWS SQS/SNS, and LocalStack.

![Node.js](https://img.shields.io/badge/Node.js-18.x-green?style=for-the-badge&logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge&logo=typescript)
![AWS](https://img.shields.io/badge/AWS-SQS%20%7C%20SNS-FF9900?style=for-the-badge&logo=amazon-aws)
![LocalStack](https://img.shields.io/badge/LocalStack-Cloud%20Emulator-085A87?style=for-the-badge&logo=localstack)

## 🎯 The Business Case

In high-volume distributed systems, processing complex workflows (like order creation, payment, and inventory updates) synchronously via HTTP can lead to bottlenecks, timeouts, and data loss.

This project demonstrates a **decoupled, asynchronous approach** where the core API simply publishes an event, and dedicated background workers process the workload at their own pace, ensuring zero data loss even during database outages.

## 🏗️ Architecture Topology

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │───▶│     API     │───▶│    SNS      │───▶│     SQS     │
│ (Producer)  │     │ (Publisher) │     │   Topic     │     │   Queue     │
└─────────────┘     └─────────────┘     └─────────────┘     └──────┬──────┘
                                                                   │
                              ┌────────────────────────────────────┘
                              │            ┌─────────────┐
                              │            │   Worker    │
                              │            │ (Consumer)  │
                              │            └──────┬──────┘
                              │                   │
                    ┌─────────┴────────┐    ┌─────▼───────┐
                    │   DLQ (orders-   │    │   Domain    │
                    │      dlq)        │    │   Logic     │
                    └──────────────────┘    └─────────────┘
```

The system implements a **Pub/Sub (Fan-out)** pattern combined with a **Message Queue** for reliable consumption:

1. **Producer:** Publishes an `OrderCreated` event to an **AWS SNS Topic**.
2. **Fan-out:** The SNS Topic pushes the event to a subscribed **AWS SQS Queue**.
3. **Consumer (Worker):** A Node.js background process continuously polls the SQS queue (Long Polling).
4. **Validation:** The payload is strictly validated at the edge using **Zod** before entering the domain layer.
5. **Resilience (DLQ):** The main queue is configured with a **RedrivePolicy** (maxReceiveCount=3). If processing fails 3 consecutive times (e.g., database outage), the "Poison Pill" message is automatically routed to a **Dead Letter Queue (DLQ)**, preventing infinite loops and keeping the main queue healthy.

## ✨ Key Engineering Patterns

- **Event-Driven Design:** Complete decoupling of producers and consumers.
- **Circuit Breaker:** The downstream call is wrapped with [opossum](https://github.com/nodeshift/opossum). Repeated failures **open** the circuit so the worker fails fast instead of hammering a dead dependency; while open, messages are not deleted, so they flow to redrive/DLQ. The breaker half-opens to probe recovery and closes once the dependency is healthy. Every transition is logged.
- **Retry with Backoff:** Transient downstream failures are retried in-process with exponential backoff and jitter before the message is surrendered to SQS. Retries run **inside** the circuit breaker, so it sees the final outcome; deterministic failures (e.g. validation) fail fast and are not retried.
- **Idempotent Consumption:** SQS delivery is *at-least-once*, so the same order can arrive twice. Each `orderId` is recorded **after** it is successfully processed; a re-delivered duplicate is skipped as a logged no-op (and still acknowledged, removing it from the queue). Failed orders are left unrecorded so a retry reprocesses them. In-memory by default, or Redis-backed so the dedupe holds across scaled-out workers.
- **Dead Letter Queue (DLQ):** Messages that fail 3 times are automatically routed via **RedrivePolicy** to a separate queue (`orders-dlq`) for inspection.
- **Long Polling:** Optimized SQS consumption (WaitTimeSeconds=20) to reduce API calls and AWS costs.
- **Fail-Fast Validation:** Zod schemas ensure only valid domain entities are processed.
- **Infrastructure as Code:** The whole topology — topic, queue, DLQ, redrive, encryption, IAM — is declared in Terraform (`infra/terraform`) and applied to LocalStack. The same code targets real AWS by clearing one variable.
- **Encryption at rest:** A customer-managed KMS key (with rotation) encrypts the topic and both queues; its key policy grants SNS only the `GenerateDataKey`/`Decrypt` it needs for fan-out.
- **Least-privilege IAM:** Separate publisher and consumer policies — the producer cannot read the queue, the worker cannot publish, and the DLQ is read-only for inspection.
- **Structured Logging:** Pino is used for high-performance, JSON-formatted observability.
- **Operational Metrics:** Prometheus counters and gauges on `/metrics` — throughput, failures split by cause, retries, breaker state, and queue/DLQ depth — with documented alert thresholds.

## 🗺️ Roadmap

A snapshot of the current stage. Checked items are implemented in this repo;
unchecked items are the planned next steps, each building on a seam already in
the code.

- [x] **Event-driven pipeline** — SNS fan-out → long-polling SQS consumer with fail-fast Zod validation.
- [x] **Dead Letter Queue** — `RedrivePolicy` (`maxReceiveCount=3`) routes poison messages to `orders-dlq`.
- [x] **Circuit Breaker** — opossum around the downstream call; opens on repeated failures so the worker fails fast.
- [x] **Retry with backoff** — transient downstream failures are retried in-process with exponential backoff + jitter before the message returns to SQS.
- [x] **Idempotent consumption** — re-delivered `orderId`s are deduped for at-least-once safety.
- [x] **Structured logging** — JSON logs via Pino.
- [x] **Unit tests + CI** — Vitest suite gated by GitHub Actions (typecheck + tests).
- [x] **Infrastructure as Code** — Terraform for SNS/SQS/DLQ with least-privilege IAM and encryption at rest (KMS).
- [x] **Operational metrics & alerting** — Prometheus metrics on `/metrics` with documented alert thresholds.
- [ ] **Private networking** — VPC endpoints for SQS/SNS, left out for now because LocalStack only mocks them, so the config could not be verified here.
- [x] **Redis-backed idempotency store** — dedupe shared across worker instances, behind the same `IdempotencyStore` interface.

## 🚀 How to Run Locally

This project uses **LocalStack** to emulate AWS services locally. No AWS account or credit card is required.

### 1. Start the Local Cloud (LocalStack)

This spins up a local AWS environment and applies the Terraform in `infra/terraform`,
creating the KMS key, SNS Topic, SQS Queue, DLQ, and IAM policies.

```bash
pnpm run infra:up
```

Terraform runs from the official Docker image when it is not installed locally, so
there is nothing to install. Useful follow-ups:

```bash
pnpm run infra:plan    # preview changes
pnpm run infra:output  # queue URLs, topic ARN, policy ARNs
```

### 2. Install Dependencies & Start the Worker

In a new terminal, start the background worker. It will immediately begin polling the local SQS queue.

```bash
pnpm install
pnpm run dev:worker
```

### 3. Trigger an Event (Producer)

In another terminal, run the test script to publish a mock order to the SNS topic.

```bash
pnpm run dev:publish
```

Watch the Worker terminal to see the event being received, validated, and processed!

### 4. Stop the Infrastructure

Destroys the Terraform-managed resources, then stops LocalStack.

```bash
pnpm run infra:down
```

### Targeting real AWS

The Terraform is not LocalStack-specific: set `localstack_endpoint = ""` and the
provider falls back to the standard AWS credential chain.

```bash
./scripts/terraform.sh apply -var 'localstack_endpoint='
```

### Running more than one worker

The default dedupe store lives in the worker's memory, so a second instance
would not recognise a duplicate the first one already handled. Point both at
Redis instead:

```bash
IDEMPOTENCY_STORE=redis pnpm run dev:worker
```

`docker compose up -d` already provides Redis (set `REDIS_PORT` if 6379 is taken
locally). Keys are namespaced `order:processed:<orderId>` and expire after
`IDEMPOTENCY_TTL_SECONDS`, which only has to outlive the window in which SQS can
still redeliver — so the set does not grow forever.

Two honest limits. If Redis is unreachable the handler rejects and the message
goes back to the queue rather than being processed undeduplicated: better a
delayed order, or one parked in the DLQ for replay, than a customer charged
twice. And because an order is recorded *after* it succeeds, two truly
simultaneous deliveries of the same `orderId` can both pass the check before
either is recorded. Closing that window needs an atomic reservation *before*
processing, which trades this risk for a worse one — an order lost if the worker
dies mid-flight.

## 🧪 Testing

### Unit tests

Fast, dependency-free unit tests run with [Vitest](https://vitest.dev) — no LocalStack
or Docker required. They cover Zod validation and the consumer's message-handling
semantics (delete-on-success; **leave-on-failure** so redrive/DLQ can take over).

```bash
pnpm test            # run once
pnpm run test:watch  # watch mode
pnpm run typecheck   # tsc --noEmit
```

CI (`.github/workflows/ci.yml`) runs `typecheck` + `test` on every push and pull
request, and a second job runs `terraform fmt -check` + `validate` so the
infrastructure is gated the same way the code is — no AWS credentials needed.

### Testing Success (Normal Order)

```bash
pnpm run dev:publish        # defaults to 99.99
```

Watch the Worker validate and process the order, then delete the message.

### Testing the Dead Letter Queue (DLQ)

The demo handler simulates a database failure for any order over 1000, which is
how the resilience path is exercised end-to-end.

```bash
pnpm run dev:publish 1500
```

Watch the Worker retry each delivery in-process with backoff; after
`maxReceiveCount=3` SQS receives, the message is moved to the DLQ.

### Inspecting the DLQ

Without `awslocal` installed, prefix these with
`docker exec $(docker ps -qf name=localstack)`.

```bash
# Check messages in the Dead Letter Queue
awslocal sqs receive-message --queue-url http://localhost:4566/000000000000/orders-dlq

# Purge all messages from DLQ (after inspection)
awslocal sqs purge-queue --queue-url http://localhost:4566/000000000000/orders-dlq

# View queue attributes (including RedrivePolicy)
awslocal sqs get-queue-attributes \
  --queue-url http://localhost:4566/000000000000/orders-queue \
  --attribute-names All
```

## 📊 Observability

The worker exposes Prometheus metrics on `http://localhost:9464/metrics` and a
liveness probe on `/health`.

```bash
curl -s localhost:9464/metrics | grep ^orders_
```

| Metric                              | Type      | What it answers                                    |
| ----------------------------------- | --------- | -------------------------------------------------- |
| `orders_processed_total`            | counter   | Messages acknowledged — *includes* duplicates skipped |
| `orders_failed_total{reason}`       | counter   | Failures, split into `validation` and `downstream`  |
| `orders_retry_total`                | counter   | In-process retries absorbed before SQS redelivery   |
| `orders_duplicate_total`            | counter   | Re-deliveries skipped by the idempotency layer      |
| `orders_circuit_state`              | gauge     | Breaker: 0 closed, 1 half-open, 2 open              |
| `orders_circuit_rejected_total`     | counter   | Calls short-circuited while the breaker was open    |
| `orders_queue_messages_visible`     | gauge     | Backlog on the main queue and the DLQ               |
| `orders_queue_messages_in_flight`   | gauge     | Received but not yet acknowledged                   |
| `order_processing_duration_seconds` | histogram | Latency, bucketed around the breaker's 3s timeout   |

Splitting failures by reason is the point of the design: `validation` means a
message will *never* succeed and is heading for the DLQ, while `downstream` is
expected to recover. One page, the other does not.

A skipped duplicate is acknowledged like any handled message, so it counts in
`orders_processed_total` too — real throughput is that minus
`orders_duplicate_total`.

### Alert thresholds

| Alert                | Condition                                                | Why                                                                     |
| -------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| **DLQ not empty**    | `orders_queue_messages_visible{queue="dlq"} > 0` for 5m   | Every DLQ message is an order that never processed — always human-owned. |
| **Backlog growing**  | `orders_queue_messages_visible{queue="main"} > 1000` for 10m | Consumers cannot keep up; scale out or investigate the downstream.    |
| **Breaker open**     | `orders_circuit_state == 2` for 2m                        | The dependency is down; a brief trip is by design, a sustained one is not. |
| **Validation spike** | `rate(orders_failed_total{reason="validation"}[5m]) > 0`  | A producer is emitting events this consumer cannot read — a contract break. |
| **Worker stalled**   | `rate(orders_processed_total[15m]) == 0` with backlog > 0 | Messages are waiting and nothing is moving.                             |

Thresholds are stated as *sustained* levels because `ApproximateNumberOfMessages`
is eventually consistent — a single reading is not enough to page someone.

## 📁 Project Structure

```
infra/terraform/             # The full AWS topology as code
├── providers.tf             # AWS provider, LocalStack endpoint overrides
├── kms.tf                   # Customer-managed key + policy allowing SNS fan-out
├── messaging.tf             # Topic, queue, DLQ, redrive, subscription
├── iam.tf                   # Least-privilege publisher & consumer policies
└── outputs.tf               # Queue URLs, topic ARN, policy ARNs

src/
├── config/                  # Environment variables validation (Zod)
├── domain/                  # Business entities, schemas & logic
│   ├── order.schema.ts      # OrderEvent schema (+ .spec.ts)
│   └── process-order.ts     # Injectable OrderHandler port (+ .spec.ts)
├── infrastructure/          # External integrations
│   ├── aws/                 # SQS and SNS clients & publishers
│   ├── idempotency/         # Dedupe decorator + in-memory and Redis stores (+ .spec.ts)
│   ├── observability/       # Pino logging, Prometheus metrics, queue-depth poller
│   └── resilience/          # Circuit breaker around the OrderHandler (+ .spec.ts)
├── presentation/            # Entrypoints
│   └── sqs.consumer.ts      # The SQS polling engine (+ .spec.ts)
├── scripts/                 # Test producers
│   └── publish-test-event.ts
└── index.ts                 # Worker bootstrap

Tests are co-located as `*.spec.ts` next to the code they cover.
```

## ⚙️ Environment Variables

The following environment variables are used (with defaults for local development):

| Variable        | Default                                                 | Description        |
| --------------- | ------------------------------------------------------- | ------------------ |
| `SQS_QUEUE_URL` | `http://localhost:4566/000000000000/orders-queue`        | Main SQS queue URL |
| `SNS_TOPIC_ARN` | `arn:aws:sns:us-east-1:000000000000:orders-events-topic` | SNS topic ARN      |
| `SQS_DLQ_URL`   | `http://localhost:4566/000000000000/orders-dlq`          | DLQ, for depth gauge |
| `AWS_REGION`    | `us-east-1`                                              | AWS region         |
| `LOG_LEVEL`     | `info`                                                   | Pino log level     |
| `METRICS_PORT`  | `9464`                                                   | `/metrics` listener |
| `QUEUE_DEPTH_INTERVAL_MS` | `30000`                                        | Queue depth poll interval |
| `IDEMPOTENCY_STORE` | `memory`                                             | `memory` or `redis` |
| `REDIS_URL`     | `redis://localhost:6379`                                 | Used when the store is `redis` |
| `IDEMPOTENCY_TTL_SECONDS` | `86400`                                        | How long an `orderId` is remembered |

The defaults match what `pnpm run infra:up` provisions; `pnpm run infra:output`
prints the live values for any other environment.

## 🔧 Troubleshooting

### Messages not being received?

- Make sure LocalStack is running: `docker ps`
- Check the queue exists: `awslocal sqs list-queues`

### Worker not processing?

- Verify the SNS subscription: `awslocal sns list-subscriptions`

### DLQ not working?

- Check the RedrivePolicy on the main queue (command above)
- Verify the DLQ exists: `awslocal sqs get-queue-url --queue-name orders-dlq`

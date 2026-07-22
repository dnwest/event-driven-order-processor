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
- **Idempotent Consumption:** SQS delivery is *at-least-once*, so the same order can arrive twice. Each `orderId` is recorded **after** it is successfully processed; a re-delivered duplicate is skipped as a logged no-op (and still acknowledged, removing it from the queue). Failed orders are left unrecorded so a retry reprocesses them.
- **Dead Letter Queue (DLQ):** Messages that fail 3 times are automatically routed via **RedrivePolicy** to a separate queue (`orders-dlq`) for inspection.
- **Long Polling:** Optimized SQS consumption (WaitTimeSeconds=20) to reduce API calls and AWS costs.
- **Fail-Fast Validation:** Zod schemas ensure only valid domain entities are processed.
- **Infrastructure as Code:** The whole topology — topic, queue, DLQ, redrive, encryption, IAM — is declared in Terraform (`infra/terraform`) and applied to LocalStack. The same code targets real AWS by clearing one variable.
- **Encryption at rest:** A customer-managed KMS key (with rotation) encrypts the topic and both queues; its key policy grants SNS only the `GenerateDataKey`/`Decrypt` it needs for fan-out.
- **Least-privilege IAM:** Separate publisher and consumer policies — the producer cannot read the queue, the worker cannot publish, and the DLQ is read-only for inspection.
- **Structured Logging:** Pino is used for high-performance, JSON-formatted observability.

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
- [ ] **Operational metrics & alerting** — processed / failed / DLQ-depth counters with documented alert thresholds.
- [ ] **Private networking** — VPC endpoints for SQS/SNS, left out for now because LocalStack only mocks them, so the config could not be verified here.
- [ ] **Redis-backed idempotency store** — the async `IdempotencyStore` interface exists so the in-memory store can be swapped for one shared across workers.

Unchecked items are listed in the order they are planned.

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

CI (`.github/workflows/ci.yml`) runs `typecheck` + `test` on every push and pull request.

### Testing Success (Normal Order)

1. Edit `src/scripts/publish-test-event.ts` and set `amount: 500.00`
2. Run `pnpm run dev:publish`
3. Watch the Worker process the order successfully

### Testing the Dead Letter Queue (DLQ)

To see the resilience patterns in action, the code is configured to simulate a database failure for any order with an amount > 1000.

1. Edit `src/scripts/publish-test-event.ts` and set `amount: 1500.00`.
2. Run `pnpm run dev:publish`.
3. Watch the Worker retry each delivery in-process with backoff; after 3 SQS receives (`maxReceiveCount=3`), the message is moved to the DLQ.

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
│   ├── idempotency/         # Dedupe store + decorator around the OrderHandler (+ .spec.ts)
│   ├── observability/       # Structured logging (Pino)
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
| `AWS_REGION`    | `us-east-1`                                              | AWS region         |
| `LOG_LEVEL`     | `info`                                                   | Pino log level     |

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

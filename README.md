# 📨 Event-Driven Order Processor

> An asynchronous order-processing worker demonstrating core Event-Driven Architecture (EDA) patterns — SNS fan-out, SQS consumption, and Dead Letter Queues — with Node.js, AWS SQS/SNS, and LocalStack.

![Node.js](https://img.shields.io/badge/Node.js-18.x-green?style=for-the-badge&logo=node.js)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=for-the-badge&logo=typescript)
![AWS](https://img.shields.io/badge/AWS-SQS%20%7C%20SNS-FF9900?style=for-the-badge&logo=amazon-aws)
![LocalStack](https://img.shields.io/badge/LocalStack-Cloud%20Emulator-085A87?style=for-the-badge&logo=localstack)
![Status](https://img.shields.io/badge/status-in%20active%20development-yellow?style=for-the-badge)

## 🚧 Project Status

**In active development.** The core event-driven pipeline described below is fully
implemented and runnable today on LocalStack. Production-hardening (circuit breaker,
idempotency, real cloud IaC with IAM/encryption, automated tests) is planned and
tracked in the **Roadmap** section below — those items are **targets, not yet shipped**.

**Implemented today:** SNS → SQS fan-out · long-polling SQS consumer · Zod fail-fast
validation · DLQ with `RedrivePolicy` (`maxReceiveCount=3`) · structured logging (Pino).

## 🎯 The Business Case

In high-volume distributed systems, processing complex workflows (like order creation, payment, and inventory updates) synchronously via HTTP can lead to bottlenecks, timeouts, and data loss.

This project demonstrates a **decoupled, asynchronous approach** where the core API simply publishes an event, and dedicated background workers process the workload at their own pace, ensuring zero data loss even during database outages.

## 🏗️ Architecture Topology

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Client    │────▶│     API     │────▶│    SNS      │────▶│     SQS     │
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
- **Dead Letter Queue (DLQ):** Messages that fail 3 times are automatically routed via **RedrivePolicy** to a separate queue (`orders-dlq`) for inspection.
- **Long Polling:** Optimized SQS consumption (WaitTimeSeconds=20) to reduce API calls and AWS costs.
- **Fail-Fast Validation:** Zod schemas ensure only valid domain entities are processed.
- **Local environment automation:** A setup script provisions the SNS Topic, SQS Queue, and DLQ on LocalStack. _(Declarative IaC with Terraform is on the Roadmap below.)_
- **Structured Logging:** Pino is used for high-performance, JSON-formatted observability.

## 🗺️ Roadmap

Planned to take this from a focused demo into a production-grade reference. These are
**not implemented yet** — they are the intended target state (also reflected in the
architecture diagram):

- [ ] **Circuit Breaker** around the downstream call — fail fast when a dependency is down
- [ ] **In-process retry with exponential backoff** for transient failures (today retry is SQS-native redelivery on a fixed visibility timeout)
- [ ] **Idempotency** — dedupe re-delivered messages (at-least-once safety)
- [ ] **Observability** — operational metrics (processed / failed / DLQ depth) + alerting thresholds
- [ ] **Infrastructure as Code** — Terraform for SNS/SQS/DLQ with least-privilege IAM, encryption at rest (SSE/KMS), and VPC endpoints
- [x] **Automated tests + CI** — unit tests (Vitest) for validation and consumer message-handling semantics, with typecheck + tests gated on every push via GitHub Actions. More resilience-specific tests land alongside the features above.

## 🚀 How to Run Locally

This project uses **LocalStack** to emulate AWS services locally. No AWS account or credit card is required.

### 1. Start the Local Cloud (LocalStack)

This will spin up a local AWS environment and automatically run the setup script to create the SNS Topic, SQS Queue, and DLQ.

```bash
pnpm run infra:up
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

```bash
pnpm run infra:down
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

1. Edit `src/scripts/publish-test-event.ts` - set `amount: 500.00`
2. Run `pnpm run dev:publish`
3. Watch the Worker process the order successfully

### Testing the Dead Letter Queue (DLQ)

To see the resilience patterns in action, the code is configured to simulate a database failure for any order with an amount > 1000.

1. Edit `src/scripts/publish-test-event.ts` and set `amount: 1500.00`.
2. Run `pnpm run dev:publish`.
3. Watch the Worker attempt to process the message exactly 3 times before the SQS automatically moves it to the DLQ, restoring silence and system health.

### Inspecting the DLQ

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
src/
├── config/                  # Environment variables validation (Zod)
├── domain/                  # Business entities, schemas & logic
│   ├── order.schema.ts      # OrderEvent schema (+ .spec.ts)
│   └── process-order.ts     # Injectable OrderHandler port (+ .spec.ts)
├── infrastructure/          # External integrations
│   ├── aws/                 # SQS and SNS clients & publishers
│   └── observability/       # Structured logging (Pino)
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
| `SQS_QUEUE_URL` | `http://localhost:4566/000000000000/orders-queue`       | Main SQS queue URL |
| `SNS_TOPIC_ARN` | `arn:aws:sns:us-east-1:000000000000:order-events-topic` | SNS topic ARN      |
| `AWS_REGION`    | `us-east-1`                                             | AWS region         |
| `LOG_LEVEL`     | `info`                                                  | Pino log level     |

## 🔧 Troubleshooting

### Messages not being received?

- Make sure LocalStack is running: `docker ps`
- Check the queue exists: `awslocal sqs list-queues`

### Worker not processing?

- Verify the SNS subscription: `awslocal sns list-subscriptions`

### DLQ not working?

- Check the RedrivePolicy on the main queue (command above)
- Verify the DLQ exists: `awslocal sqs get-queue-url --queue-name orders-dlq`

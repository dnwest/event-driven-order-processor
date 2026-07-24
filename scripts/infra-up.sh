#!/usr/bin/env bash
# Brings up LocalStack and provisions the topology with Terraform.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker compose -f "$ROOT/docker-compose.yml" up -d

echo "Waiting for LocalStack..."
for _ in $(seq 1 60); do
  if curl -sf http://localhost:4566/_localstack/health >/dev/null; then
    break
  fi
  sleep 1
done

# Bootstrap the state bucket before init: the bucket that holds the remote
# state cannot be managed by the state living inside it. Idempotent — a second
# run just finds the bucket already there.
echo "Ensuring the Terraform state bucket exists..."
docker compose -f "$ROOT/docker-compose.yml" exec -T localstack \
  awslocal s3api create-bucket --bucket orders-tf-state >/dev/null 2>&1 || true

"$ROOT/scripts/terraform.sh" init -input=false -reconfigure \
  -backend-config=backend/localstack.s3.tfbackend
"$ROOT/scripts/terraform.sh" apply -auto-approve -input=false

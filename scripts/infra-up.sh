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

"$ROOT/scripts/terraform.sh" init -input=false
"$ROOT/scripts/terraform.sh" apply -auto-approve -input=false

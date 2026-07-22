#!/usr/bin/env bash
# Runs Terraform against infra/terraform, using the local binary when it exists
# and the official image otherwise, so the repo has no install step.
set -euo pipefail

TF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../infra/terraform" && pwd)"
TF_VERSION="${TF_VERSION:-1.14}"

if command -v terraform >/dev/null 2>&1; then
  terraform -chdir="$TF_DIR" "$@"
else
  # --network host so the container reaches LocalStack on localhost:4566.
  docker run --rm \
    --network host \
    --user "$(id -u):$(id -g)" \
    -e TF_DATA_DIR=/workspace/.terraform \
    -v "$TF_DIR:/workspace" \
    -w /workspace \
    "hashicorp/terraform:${TF_VERSION}" "$@"
fi

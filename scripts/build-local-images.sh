#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TAG="${1:-dev}"
BASE_IMAGE="attractor/factory"

echo "Building monorepo runtime image..."
docker build -t "${BASE_IMAGE}:$TAG" .

echo "Tagging service images..."
docker tag "${BASE_IMAGE}:$TAG" "attractor/factory-api:$TAG"
docker tag "${BASE_IMAGE}:$TAG" "attractor/factory-web:$TAG"
docker tag "${BASE_IMAGE}:$TAG" "attractor/factory-runner-controller:$TAG"
docker tag "${BASE_IMAGE}:$TAG" "attractor/factory-runner:$TAG"

echo "Built tags:"
echo "  attractor/factory-api:$TAG"
echo "  attractor/factory-web:$TAG"
echo "  attractor/factory-runner-controller:$TAG"
echo "  attractor/factory-runner:$TAG"

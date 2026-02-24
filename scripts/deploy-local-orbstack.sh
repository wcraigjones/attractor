#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TAG="${1:-dev}"
NAMESPACE="${NAMESPACE:-factory-system}"

helm upgrade --install factory-system ./deploy/helm/factory-system \
  --namespace "$NAMESPACE" --create-namespace \
  -f ./deploy/helm/factory-system/values.local-orbstack.yaml \
  --set images.api.repository=attractor/factory-api \
  --set images.api.tag="$TAG" \
  --set images.web.repository=attractor/factory-web \
  --set images.web.tag="$TAG" \
  --set images.controller.repository=attractor/factory-runner-controller \
  --set images.controller.tag="$TAG" \
  --set images.runner.repository=attractor/factory-runner \
  --set images.runner.tag="$TAG"

kubectl -n "$NAMESPACE" rollout status deployment/factory-api --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/factory-web --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/factory-runner-controller --timeout=180s

echo "factory-system deployed in namespace $NAMESPACE"

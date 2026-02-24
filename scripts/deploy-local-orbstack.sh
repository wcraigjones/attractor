#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

TAG="${1:-dev}"
NAMESPACE="${NAMESPACE:-factory-system}"
TRAEFIK_NAMESPACE="${TRAEFIK_NAMESPACE:-kube-system}"
TRAEFIK_RELEASE="${TRAEFIK_RELEASE:-traefik}"

if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
  kubectl create namespace "$NAMESPACE"
fi

helm repo add traefik https://traefik.github.io/charts >/dev/null 2>&1 || true
helm repo update traefik >/dev/null

helm upgrade --install "$TRAEFIK_RELEASE" traefik/traefik \
  --namespace "$TRAEFIK_NAMESPACE" \
  --set service.type=LoadBalancer \
  --set providers.kubernetesIngress.publishedService.enabled=true \
  --set ingressClass.enabled=true \
  --set ingressClass.name=traefik \
  --set ingressRoute.dashboard.enabled=false >/dev/null

kubectl -n "$TRAEFIK_NAMESPACE" rollout status deployment/"$TRAEFIK_RELEASE" --timeout=180s

helm upgrade --install factory-system ./deploy/helm/factory-system \
  --namespace "$NAMESPACE" \
  -f ./deploy/helm/factory-system/values.local-orbstack.yaml \
  --set images.api.repository=attractor/factory-api \
  --set images.api.tag="$TAG" \
  --set images.web.repository=attractor/factory-web \
  --set images.web.tag="$TAG" \
  --set images.controller.repository=attractor/factory-runner-controller \
  --set images.controller.tag="$TAG" \
  --set images.runner.repository=attractor/factory-runner \
  --set images.runner.tag="$TAG"

kubectl -n "$NAMESPACE" rollout restart deployment/factory-api >/dev/null
kubectl -n "$NAMESPACE" rollout restart deployment/factory-web >/dev/null
kubectl -n "$NAMESPACE" rollout restart deployment/factory-runner-controller >/dev/null

kubectl -n "$NAMESPACE" rollout status deployment/factory-api --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/factory-web --timeout=180s
kubectl -n "$NAMESPACE" rollout status deployment/factory-runner-controller --timeout=180s

TRAEFIK_ADDR="$(kubectl -n "$TRAEFIK_NAMESPACE" get svc "$TRAEFIK_RELEASE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}')"
if [[ -z "$TRAEFIK_ADDR" ]]; then
  TRAEFIK_ADDR="$(kubectl -n "$TRAEFIK_NAMESPACE" get svc "$TRAEFIK_RELEASE" -o jsonpath='{.status.loadBalancer.ingress[0].hostname}')"
fi
if [[ -z "$TRAEFIK_ADDR" ]]; then
  TRAEFIK_ADDR="$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')"
fi

WEB_URL="http://$TRAEFIK_ADDR"
API_URL="$WEB_URL/api"

echo "factory-system deployed in namespace $NAMESPACE"
echo "Web URL: $WEB_URL"
echo "API URL: $API_URL"

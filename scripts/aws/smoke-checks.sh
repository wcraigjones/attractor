#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/aws/common.sh
source "$SCRIPT_DIR/common.sh"
# shellcheck source=scripts/lib/api-auth.sh
source "$SCRIPT_DIR/../lib/api-auth.sh"

require_cmds aws kubectl curl jq
assert_account
update_kubeconfig

echo "Checking CloudFormation stack statuses..."
for stack in "$NETWORK_STACK_NAME" "$EKS_STACK_NAME" "$ECR_STACK_NAME" "$CERT_STACK_NAME" "$DNS_STACK_NAME"; do
  status="$(aws_cli cloudformation describe-stacks --stack-name "$stack" --query 'Stacks[0].StackStatus' --output text)"
  echo "  $stack: $status"
  if [[ "$status" != *_COMPLETE ]]; then
    echo "error: stack $stack is not complete" >&2
    exit 1
  fi
done

echo "Checking workload readiness in namespace $NAMESPACE..."
kubectl -n "$NAMESPACE" get pods

echo "Checking ingress..."
kubectl -n "$NAMESPACE" get ingress factory-system

AUTH_SECRET_NAME="$(kubectl -n "$NAMESPACE" get deployment factory-api -o jsonpath='{range .spec.template.spec.containers[0].env[?(@.name=="FACTORY_AUTH_BASIC_PASSWORD_HASH")]}{.valueFrom.secretKeyRef.name}{end}')"
AUTH_ENABLED="false"
if [[ -n "$AUTH_SECRET_NAME" ]]; then
  AUTH_ENABLED="true"
fi

echo "Health check: https://${DOMAIN_NAME}/healthz"
HEALTH_RESPONSE="$(curl -fsS "https://${DOMAIN_NAME}/healthz")"
echo "Health response: $HEALTH_RESPONSE"

if [[ "$AUTH_ENABLED" == "true" ]]; then
  if [[ -n "${FACTORY_AUTH_BASIC_PASSWORD:-}" ]]; then
    echo "Authenticated API check: https://${DOMAIN_NAME}/api/models/providers"
    API_STATUS="$(curl -fsS "${API_AUTH_CURL_ARGS[@]}" -o /tmp/factory-api-providers.json -w '%{http_code}' "https://${DOMAIN_NAME}/api/models/providers")"
    echo "API status: $API_STATUS"
    rm -f /tmp/factory-api-providers.json
    if [[ "$API_STATUS" != "200" ]]; then
      echo "error: expected authenticated API status 200" >&2
      exit 1
    fi

    echo "Authenticated web root check: https://${DOMAIN_NAME}/"
    WEB_STATUS="$(curl -fsS "${API_AUTH_CURL_ARGS[@]}" -o /dev/null -w '%{http_code}' "https://${DOMAIN_NAME}/")"
    echo "Web status: $WEB_STATUS"
    if [[ "$WEB_STATUS" != "200" ]]; then
      echo "error: expected authenticated web status 200" >&2
      exit 1
    fi
  else
    TMP_HEADERS="$(mktemp)"
    TMP_BODY="$(mktemp)"
    trap 'rm -f "$TMP_HEADERS" "$TMP_BODY"' EXIT

    echo "Unauthenticated API check: https://${DOMAIN_NAME}/api/models/providers"
    API_STATUS="$(curl -sS -D "$TMP_HEADERS" -o "$TMP_BODY" -w '%{http_code}' "https://${DOMAIN_NAME}/api/models/providers")"
    echo "API status: $API_STATUS"
    if [[ "$API_STATUS" != "401" ]]; then
      echo "error: expected unauthenticated API status 401" >&2
      exit 1
    fi
    if ! grep -qi '^www-authenticate: Basic ' "$TMP_HEADERS"; then
      echo "error: expected WWW-Authenticate Basic header" >&2
      exit 1
    fi

    echo "Unauthenticated web root check: https://${DOMAIN_NAME}/"
    WEB_STATUS="$(curl -sS -o /dev/null -w '%{http_code}' "https://${DOMAIN_NAME}/")"
    echo "Web status: $WEB_STATUS"
    if [[ "$WEB_STATUS" != "401" ]]; then
      echo "error: expected unauthenticated web status 401" >&2
      exit 1
    fi
  fi
else
  echo "Factory auth is disabled; verifying public API/web access."
  API_STATUS="$(curl -fsS -o /tmp/factory-api-providers.json -w '%{http_code}' "https://${DOMAIN_NAME}/api/models/providers")"
  echo "API status: $API_STATUS"
  rm -f /tmp/factory-api-providers.json
  WEB_STATUS="$(curl -fsS -o /dev/null -w '%{http_code}' "https://${DOMAIN_NAME}/")"
  echo "Web status: $WEB_STATUS"
fi

if [[ -n "${PROJECT_ID:-}" && -n "${ATTRACTOR_ID:-}" ]]; then
  echo "Queueing validation run for project ${PROJECT_ID}"
  curl -fsS "${API_AUTH_CURL_ARGS[@]}" -X POST "https://${DOMAIN_NAME}/api/runs" \
    -H 'Content-Type: application/json' \
    -d "{\"projectId\":\"${PROJECT_ID}\",\"attractorDefId\":\"${ATTRACTOR_ID}\",\"runType\":\"task\",\"sourceBranch\":\"main\",\"targetBranch\":\"main\"}" | jq .
else
  echo "Skipping run queue validation (set PROJECT_ID and ATTRACTOR_ID to enable)."
fi

echo "Smoke checks passed."

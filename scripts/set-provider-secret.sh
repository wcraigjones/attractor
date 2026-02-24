#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080}"
PROJECT_ID="${PROJECT_ID:-}"
PROVIDER="${PROVIDER:-anthropic}"
SECRET_NAME="${SECRET_NAME:-llm-${PROVIDER}}"
K8S_SECRET_NAME="${K8S_SECRET_NAME:-factory-secret-${SECRET_NAME}}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "PROJECT_ID is required" >&2
  exit 1
fi

logical_key="${LOGICAL_KEY:-}"
secret_key="${SECRET_KEY:-}"
secret_value="${SECRET_VALUE:-}"

case "$PROVIDER" in
  anthropic)
    if [[ -z "$logical_key" && -n "${ANTHROPIC_OAUTH_TOKEN:-}" && -z "${ANTHROPIC_API_KEY:-}" && -z "$secret_value" ]]; then
      logical_key="oauthToken"
    fi
    logical_key="${logical_key:-apiKey}"
    if [[ "$logical_key" == "oauthToken" ]]; then
      secret_key="${secret_key:-anthropic_oauth_token}"
      secret_value="${secret_value:-${ANTHROPIC_OAUTH_TOKEN:-}}"
    else
      secret_key="${secret_key:-anthropic_api_key}"
      secret_value="${secret_value:-${ANTHROPIC_API_KEY:-}}"
    fi
    ;;
  openai|openai-codex)
    logical_key="${logical_key:-apiKey}"
    secret_key="${secret_key:-openai_api_key}"
    secret_value="${secret_value:-${OPENAI_API_KEY:-}}"
    ;;
  google)
    logical_key="${logical_key:-apiKey}"
    secret_key="${secret_key:-gemini_api_key}"
    secret_value="${secret_value:-${GEMINI_API_KEY:-}}"
    ;;
  groq)
    logical_key="${logical_key:-apiKey}"
    secret_key="${secret_key:-groq_api_key}"
    secret_value="${secret_value:-${GROQ_API_KEY:-}}"
    ;;
  xai)
    logical_key="${logical_key:-apiKey}"
    secret_key="${secret_key:-xai_api_key}"
    secret_value="${secret_value:-${XAI_API_KEY:-}}"
    ;;
  openrouter)
    logical_key="${logical_key:-apiKey}"
    secret_key="${secret_key:-openrouter_api_key}"
    secret_value="${secret_value:-${OPENROUTER_API_KEY:-}}"
    ;;
  *)
    ;;
esac

if [[ -z "$logical_key" || -z "$secret_key" ]]; then
  echo "Could not infer mapping for provider '$PROVIDER'. Set LOGICAL_KEY and SECRET_KEY." >&2
  exit 1
fi

if [[ -z "$secret_value" ]]; then
  echo "No secret value found for provider '$PROVIDER' and logical key '$logical_key'." >&2
  echo "Set SECRET_VALUE or provider env vars (for example ANTHROPIC_API_KEY)." >&2
  exit 1
fi

payload=$(cat <<JSON
{
  "name": "$SECRET_NAME",
  "provider": "$PROVIDER",
  "k8sSecretName": "$K8S_SECRET_NAME",
  "keyMappings": {
    "$logical_key": "$secret_key"
  },
  "values": {
    "$secret_key": "$secret_value"
  }
}
JSON
)

response=$(curl -sS -X POST "$API_BASE_URL/api/projects/$PROJECT_ID/secrets" \
  -H 'content-type: application/json' \
  -d "$payload")

echo "$response"

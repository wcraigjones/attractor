#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080}"
REPO_FULL_NAME="${REPO_FULL_NAME:-wcraigjones/attractor}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
ATTRACTOR_PATH="${ATTRACTOR_PATH:-factory/self-bootstrap.dot}"
MODEL_PROVIDER="${MODEL_PROVIDER:-anthropic}"
MODEL_ID="${MODEL_ID:-claude-sonnet-4-20250514}"
REASONING_LEVEL="${REASONING_LEVEL:-high}"
TARGET_BRANCH="${TARGET_BRANCH:-attractor/self-factory}"
SET_PROVIDER_SECRET="${SET_PROVIDER_SECRET:-false}"
SECRET_NAME="${SECRET_NAME:-llm-${MODEL_PROVIDER}}"

if [[ ! -f "$ATTRACTOR_PATH" ]]; then
  echo "Attractor file not found: $ATTRACTOR_PATH" >&2
  exit 1
fi
ATTRACTOR_CONTENT="$(cat "$ATTRACTOR_PATH")"

bootstrap_payload=$(
  REPO_FULL_NAME="$REPO_FULL_NAME" \
  DEFAULT_BRANCH="$DEFAULT_BRANCH" \
  ATTRACTOR_PATH="$ATTRACTOR_PATH" \
  ATTRACTOR_CONTENT="$ATTRACTOR_CONTENT" \
  MODEL_PROVIDER="$MODEL_PROVIDER" \
  MODEL_ID="$MODEL_ID" \
  REASONING_LEVEL="$REASONING_LEVEL" \
  node -e '
    const payload = {
      repoFullName: process.env.REPO_FULL_NAME,
      defaultBranch: process.env.DEFAULT_BRANCH,
      attractorPath: process.env.ATTRACTOR_PATH,
      attractorContent: process.env.ATTRACTOR_CONTENT,
      modelConfig: {
        provider: process.env.MODEL_PROVIDER,
        modelId: process.env.MODEL_ID,
        reasoningLevel: process.env.REASONING_LEVEL,
        temperature: 0.2
      }
    };
    process.stdout.write(JSON.stringify(payload));
  '
)

bootstrap_response=$(curl -sS -X POST "$API_BASE_URL/api/bootstrap/self" \
  -H 'content-type: application/json' \
  -d "$bootstrap_payload")

echo "Bootstrap response:"
echo "$bootstrap_response"

project_id=$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.project.id)' "$bootstrap_response")
attractor_id=$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.attractor.id)' "$bootstrap_response")

if [[ "$SET_PROVIDER_SECRET" == "true" ]]; then
  secret_response=$(API_BASE_URL="$API_BASE_URL" \
    PROJECT_ID="$project_id" \
    PROVIDER="$MODEL_PROVIDER" \
    SECRET_NAME="$SECRET_NAME" \
    ./scripts/set-provider-secret.sh)

  echo "Secret response:"
  echo "$secret_response"
fi

run_payload=$(cat <<JSON
{
  "projectId": "$project_id",
  "attractorDefId": "$attractor_id",
  "runType": "planning",
  "sourceBranch": "$DEFAULT_BRANCH",
  "targetBranch": "$TARGET_BRANCH"
}
JSON
)

run_response=$(curl -sS -X POST "$API_BASE_URL/api/runs" \
  -H 'content-type: application/json' \
  -d "$run_payload")

echo "Run response:"
echo "$run_response"

echo "Tip: stream events with"
echo "  curl -N $API_BASE_URL/api/runs/\$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.runId)' '$run_response')/events"

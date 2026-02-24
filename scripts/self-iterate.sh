#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080}"
PROJECT_ID="${PROJECT_ID:-}"
ATTRACTOR_ID="${ATTRACTOR_ID:-}"
SOURCE_BRANCH="${SOURCE_BRANCH:-main}"
TARGET_BRANCH="${TARGET_BRANCH:-attractor/self-iterate}"
MODEL_PROVIDER="${MODEL_PROVIDER:-anthropic}"
MODEL_ID="${MODEL_ID:-claude-sonnet-4-20250514}"
REASONING_LEVEL="${REASONING_LEVEL:-high}"

if [[ -z "$PROJECT_ID" || -z "$ATTRACTOR_ID" ]]; then
  echo "PROJECT_ID and ATTRACTOR_ID are required" >&2
  exit 1
fi

payload=$(cat <<JSON
{
  "attractorDefId": "$ATTRACTOR_ID",
  "sourceBranch": "$SOURCE_BRANCH",
  "targetBranch": "$TARGET_BRANCH",
  "modelConfig": {
    "provider": "$MODEL_PROVIDER",
    "modelId": "$MODEL_ID",
    "reasoningLevel": "$REASONING_LEVEL",
    "temperature": 0.2
  }
}
JSON
)

response=$(curl -sS -X POST "$API_BASE_URL/api/projects/$PROJECT_ID/self-iterate" \
  -H 'content-type: application/json' \
  -d "$payload")

echo "$response"

#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080}"
ATTRACTOR_NAME="${ATTRACTOR_NAME:-security-review-council}"
ATTRACTOR_PATH="${ATTRACTOR_PATH:-factory/security-review-council.dot}"
DEFAULT_RUN_TYPE="${DEFAULT_RUN_TYPE:-task}"
ACTIVE="${ACTIVE:-true}"
DESCRIPTION="${DESCRIPTION:-Global multi-model security review council (artifact-only task run).}"

payload=$(cat <<JSON
{
  "name": "$ATTRACTOR_NAME",
  "repoPath": "$ATTRACTOR_PATH",
  "defaultRunType": "$DEFAULT_RUN_TYPE",
  "description": "$DESCRIPTION",
  "active": $ACTIVE
}
JSON
)

response=$(curl -sS -X POST "$API_BASE_URL/api/attractors/global" \
  -H 'content-type: application/json' \
  -d "$payload")

echo "$response"

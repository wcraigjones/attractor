#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080}"
REPO_FULL_NAME="${REPO_FULL_NAME:-wcraigjones/attractor}"
DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"
ATTRACTOR_PATH="${ATTRACTOR_PATH:-factory/self-bootstrap.dot}"
MODEL_PROVIDER="${MODEL_PROVIDER:-anthropic}"
MODEL_ID="${MODEL_ID:-claude-sonnet-4-20250514}"
REASONING_LEVEL="${REASONING_LEVEL:-high}"
PLANNING_TARGET_BRANCH="${PLANNING_TARGET_BRANCH:-attractor/self-plan}"
IMPLEMENTATION_TARGET_BRANCH="${IMPLEMENTATION_TARGET_BRANCH:-attractor/self-iterate}"
SET_PROVIDER_SECRET="${SET_PROVIDER_SECRET:-true}"
POLL_SECONDS="${POLL_SECONDS:-5}"

terminal_statuses=("SUCCEEDED" "FAILED" "CANCELED" "TIMEOUT")

contains_terminal_status() {
  local status="$1"
  for terminal in "${terminal_statuses[@]}"; do
    if [[ "$terminal" == "$status" ]]; then
      return 0
    fi
  done
  return 1
}

echo "Bootstrapping self project..."
bootstrap_payload=$(cat <<JSON
{
  "repoFullName": "$REPO_FULL_NAME",
  "defaultBranch": "$DEFAULT_BRANCH",
  "attractorPath": "$ATTRACTOR_PATH",
  "modelConfig": {
    "provider": "$MODEL_PROVIDER",
    "modelId": "$MODEL_ID",
    "reasoningLevel": "$REASONING_LEVEL",
    "temperature": 0.2
  }
}
JSON
)

bootstrap_response=$(curl -sS -X POST "$API_BASE_URL/api/bootstrap/self" \
  -H 'content-type: application/json' \
  -d "$bootstrap_payload")

project_id=$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.project.id)' "$bootstrap_response")
attractor_id=$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.attractor.id)' "$bootstrap_response")

echo "project_id=$project_id"
echo "attractor_id=$attractor_id"

if [[ "$SET_PROVIDER_SECRET" == "true" ]]; then
  echo "Configuring provider secret for $MODEL_PROVIDER..."
  API_BASE_URL="$API_BASE_URL" \
    PROJECT_ID="$project_id" \
    PROVIDER="$MODEL_PROVIDER" \
    ./scripts/set-provider-secret.sh >/dev/null
fi

echo "Queueing planning run..."
planning_payload=$(cat <<JSON
{
  "projectId": "$project_id",
  "attractorDefId": "$attractor_id",
  "runType": "planning",
  "sourceBranch": "$DEFAULT_BRANCH",
  "targetBranch": "$PLANNING_TARGET_BRANCH"
}
JSON
)

planning_response=$(curl -sS -X POST "$API_BASE_URL/api/runs" \
  -H 'content-type: application/json' \
  -d "$planning_payload")
planning_run_id=$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.runId)' "$planning_response")

echo "planning_run_id=$planning_run_id"

echo "Waiting for planning run to complete..."
planning_status=""
while true; do
  run_json=$(curl -sS "$API_BASE_URL/api/runs/$planning_run_id")
  planning_status=$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.status)' "$run_json")
  echo "planning_status=$planning_status"
  if contains_terminal_status "$planning_status"; then
    break
  fi
  sleep "$POLL_SECONDS"
done

if [[ "$planning_status" != "SUCCEEDED" ]]; then
  echo "Planning run did not succeed. Inspect: $API_BASE_URL/api/runs/$planning_run_id" >&2
  exit 1
fi

echo "Queueing implementation run from latest planning bundle..."
implementation_payload=$(cat <<JSON
{
  "attractorDefId": "$attractor_id",
  "sourceBranch": "$DEFAULT_BRANCH",
  "targetBranch": "$IMPLEMENTATION_TARGET_BRANCH"
}
JSON
)

implementation_response=$(curl -sS -X POST "$API_BASE_URL/api/projects/$project_id/self-iterate" \
  -H 'content-type: application/json' \
  -d "$implementation_payload")
implementation_run_id=$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.runId)' "$implementation_response")

echo "implementation_run_id=$implementation_run_id"
echo "Waiting for implementation run to complete..."

implementation_status=""
implementation_pr_url=""
while true; do
  run_json=$(curl -sS "$API_BASE_URL/api/runs/$implementation_run_id")
  implementation_status=$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.status)' "$run_json")
  implementation_pr_url=$(node -e 'const d=JSON.parse(process.argv[1]); console.log(d.prUrl ?? "")' "$run_json")
  echo "implementation_status=$implementation_status"
  if contains_terminal_status "$implementation_status"; then
    break
  fi
  sleep "$POLL_SECONDS"
done

if [[ "$implementation_status" != "SUCCEEDED" ]]; then
  echo "Implementation run did not succeed. Inspect: $API_BASE_URL/api/runs/$implementation_run_id" >&2
  exit 1
fi

echo "Self-cycle complete."
if [[ -n "$implementation_pr_url" ]]; then
  echo "pr_url=$implementation_pr_url"
fi
echo "planning_run=$planning_run_id implementation_run=$implementation_run_id"

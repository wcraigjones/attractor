# Attractor

This repository contains [NLSpecs](#terminology) to build your own version of Attractor to create your own software factory.

Although bringing your own agentic loop and unified LLM SDK is not required to build your own Attractor, we highly recommend controlling the stack so you have a strong foundation.

## Specs

- [Attractor Specification](./attractor-spec.md)
- [Coding Agent Loop Specification](./coding-agent-loop-spec.md)
- [Unified LLM Client Specification](./unified-llm-spec.md)

## Building Attractor

Supply the following prompt to a modern coding agent (Claude Code, Codex, OpenCode, Amp, Cursor, etc):

```
codeagent> Implement Attractor as described by https://github.com/strongdm/attractor
```

## Monorepo Layout

- `apps/factory-api`: Control-plane API (projects/secrets/attractors/runs, model catalog, SSE events)
- `apps/factory-web`: Web control surface (MVP shell)
- `apps/factory-runner-controller`: Redis queue consumer that creates Kubernetes Jobs
- `apps/factory-runner`: Per-run execution worker (planning/implementation baseline)
- `packages/shared-types`: Shared API/runtime contracts and Redis key conventions
- `packages/shared-k8s`: Kubernetes helper logic and secret env projections
- `deploy/helm/factory-system`: OrbStack-focused Helm chart
- `prisma/`: Postgres schema + initial migration
- `factory/self-bootstrap.dot`: baseline self-factory pipeline definition
- `scripts/`: local image build, OrbStack deploy, and self-bootstrap helpers

## Local Setup

```bash
npm install
npm run prisma:generate
npm run check-types
npm run test
```

For iterative work (service-by-service):

```bash
npm run dev:api
npm run dev:web
npm run dev:controller
npm run dev:runner
```

## Local OrbStack Bootstrap

Build local images:

```bash
npm run images:build:local
```

Deploy stack to OrbStack Kubernetes:

```bash
npm run k8s:deploy:local
```

## Self-Bootstrap Run

After API is reachable (port-forward or ingress), bootstrap the repo and queue a planning run:

```bash
API_BASE_URL=http://localhost:8080 npm run bootstrap:self
```

## LLM Runtime

Attractor now mandates [`@mariozechner/pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai) as the only LLM runtime layer for node execution. No direct provider SDK imports are used in source modules.

## API (MVP Endpoints)

Run the API locally:

```bash
npm run dev:api
```

Implemented endpoints:

- `GET /api/models/providers`
- `GET /api/models?provider=<provider>`
- `POST /api/projects`
- `GET /api/projects`
- `POST /api/bootstrap/self`
- `POST /api/projects/{projectId}/repo/connect/github`
- `POST /api/projects/{projectId}/secrets`
- `GET /api/projects/{projectId}/secrets`
- `POST /api/projects/{projectId}/attractors`
- `GET /api/projects/{projectId}/attractors`
- `GET /api/projects/{projectId}/runs`
- `POST /api/runs`
- `GET /api/runs/{runId}`
- `GET /api/runs/{runId}/events` (SSE)
- `GET /api/runs/{runId}/artifacts`
- `POST /api/runs/{runId}/cancel`

## Prisma

Apply migrations:

```bash
npm run prisma:migrate:dev
```

## Helm (Phase 0 Bootstrap)

Render chart:

```bash
npm run phase0:helm:template
```

Install to OrbStack:

```bash
helm upgrade --install factory-system ./deploy/helm/factory-system \
  --namespace factory-system --create-namespace \
  -f ./deploy/helm/factory-system/values.local-orbstack.yaml
```

## Terminology

- **NLSpec** (Natural Language Spec): a human-readable spec intended to be  directly usable by coding agents to implement/validate behavior.

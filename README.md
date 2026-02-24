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

## Local Setup

```bash
npm install
npm run check-types
npm run test
```

For iterative work:

```bash
npm run dev
```

## LLM Runtime

Attractor now mandates [`@mariozechner/pi-ai`](https://github.com/badlogic/pi-mono/tree/main/packages/ai) as the only LLM runtime layer for node execution. No direct provider SDK imports are used in source modules.

## API (MVP)

Run the API locally:

```bash
npm run dev:api
```

Endpoints:

- `GET /api/models/providers`
- `GET /api/models?provider=<provider>`

## Terminology

- **NLSpec** (Natural Language Spec): a human-readable spec intended to be  directly usable by coding agents to implement/validate behavior.

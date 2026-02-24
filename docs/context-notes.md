# Context Notes

This repository currently contains three NL specs and no implementation code:

- `attractor-spec.md`: DOT-based orchestration engine for AI workflows
- `coding-agent-loop-spec.md`: provider-aligned coding-agent session loop
- `unified-llm-spec.md`: multi-provider LLM client contract

## Key Takeaways from Local Specs

- Attractor is a headless pipeline runner driven by a strict DOT subset, typed attributes, and checkpointed execution.
- The orchestration layer is independent of any one LLM vendor and expects a pluggable backend interface.
- Human-in-the-loop pauses, retries, conditional routing, and extensibility hooks are first-class features.

## Upstream Reference (pi-mono/packages/ai)

`https://github.com/badlogic/pi-mono/tree/main/packages/ai` is a TypeScript ESM package that uses:

- Node 20+
- `typescript` (`tsgo` in upstream)
- `vitest` for tests
- provider adapter modules under `src/providers`
- typed shared contracts under `src/types.ts`

## Setup Decisions Applied Here

- Bootstrap as TypeScript + ESM + Vitest to align with the reference project's runtime and tooling style.
- Keep scaffold minimal (`src/`, `test/`, build/typecheck/test scripts) so architecture decisions stay open.
- Preserve specs as source-of-truth inputs for the upcoming implementation discussion.


# Task Review Framework (v1)

This framework standardizes post-run human review for Attractor tasks so reviews are fast, focused, and auditable.

## Goals

- Complete each run review within 24 hours of run creation.
- Focus human attention on high-risk code and functional evidence.
- Capture reviewer decisions with checklist-backed attestation.

## Review Pack Structure

Each run review pack includes:

1. Context summary
- Suggested summary extracted from `implementation-note.md`.

2. Critical sections
- Ranked file paths extracted from `implementation.patch`.
- Risk levels: `high`, `medium`, `low`.

3. Artifact focus list
- Prioritized artifacts to review first:
  - `implementation.patch`
  - `implementation-note.md`
  - `plan.md`
  - `acceptance-tests.md`
  - `tasks.json`

4. Reviewer checklist
- Summary reviewed.
- Critical code reviewed.
- Artifacts reviewed.
- Functional validation reviewed.

5. Decision + evidence
- Decision values: `APPROVE`, `REQUEST_CHANGES`, `REJECT`, `EXCEPTION`.
- Non-approval decisions require notes.
- Approvals require all checklist items.

## SLA Model

- Due time = `run.createdAt + 24h`.
- Status states:
  - On track
  - Near deadline (<=120 min remaining)
  - Overdue

## Audit Fields

Persisted per run review:

- `runId`
- `reviewer`
- `decision`
- `checklistJson`
- `summary`
- `criticalFindings`
- `artifactFindings`
- `attestation`
- `reviewedAt`

## API

- `GET /api/runs/:runId/review`
  - Returns framework metadata, SLA status, review pack, checklist template, and existing review.
- `PUT /api/runs/:runId/review`
  - Upserts review decision + evidence and emits `RunReviewUpdated` event.

## UI Integration

The run detail page includes a `Review` tab that surfaces SLA, critical sections, artifact focus, checklist, and decision submission.

# UI Fixture Update Workflow

Use this workflow when an API contract or response fixture intentionally changes.

## Required Steps
1. Update the Zod contract in `api/src/contracts/studyPack.ts`.
2. Update the matching snapshot in `api/fixtures/contracts`.
3. Update UI tests or mocked responses under `web/tests` when the UI consumes the changed field.
4. Run `npm run gate:contracts`.
5. Run `npm exec --workspace @ultrawiki/web -- vitest run`.
6. Document the compatibility impact in the ticket or release note.

## Rules
- Do not update UI fixtures without updating contract snapshots when the API shape changed.
- Do not update contract snapshots without a passing parser/contract test.
- Additive fields must be backward compatible unless the ticket explicitly includes a migration plan.
- Breaking changes require a schema-version bump and release readiness evidence.

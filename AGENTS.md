# Agent Rules

## Git commits

- Never create a commit unless the user explicitly asks for one. Leave changes uncommitted for the user to review and commit.

## User guide

- Any new feature, rule change, renamed field, import behavior change, document-template behavior change, dispatcher logic change, or settings change must be accompanied by an update to the in-app user guide.
- The main guide is implemented in `src/components/user-guide-page.tsx`.
- Keep the guide user-facing: describe what the user sees, what to click, what the system checks, and practical cases.

## Database migrations

- Never write migration SQL files manually.
- Treat `src/db/schema.ts` as the source of truth for database shape.
- For schema changes, update the Drizzle schema first, then generate migrations with `pnpm db:generate`.
- Review generated migrations before running them, but do not hand-author migration files.
- Apply local migrations with `pnpm db:migrate`.
- Always apply migrations to a remote database with `pnpm db:remote-migration`. This script uses `DATABASE_URL_REMOTE_FOR_MIGRATIONS`; never run `drizzle-kit migrate` directly against a remote database and never use the app's `DATABASE_URL` for remote migrations.

## Validation and dispatcher rules

- System-managed fields must never appear in the weld-joint create/edit form. Requests and request dates, LNK/PSTO results and conclusions, derived statuses, dispatcher data, service timestamps, and document assignments such as JSR, Checklist, and ZNI are changed only by their dedicated workflows and remain read-only in report tables. Add regression coverage whenever a new system-managed weld field is introduced.
- Import, mass-fill, and replacement validation must check the final record after imported values are merged with the stored weld joint. A partial update must not bypass a save check.
- When one import row has several simultaneously detectable field errors, report and highlight all of them together instead of stopping after the first field error. Add a regression test for combined errors whenever a new import validation can overlap another one.
- Any new or changed dispatcher rule that can affect existing weld joints must invalidate the persisted dispatcher calculation by incrementing `DISPATCHER_TASK_CALCULATION_VERSION` in `src/lib/dispatcher-task-index-payload.ts`.
- Every new ZV/DZ pair must have regression coverage for the form/server validation, dispatcher task code, persisted row index, and the virtual `dispatcherTasks` field for already stored weld joints.

## Full pre-commit audit

- When the user says `Проведи полную предкоммитную проверку.`, treat it as a request for a risk-based audit of all uncommitted changes, not just a test-suite run. Review the complete diff, trace affected workflows end to end, check interactions with existing rules and settings, remove dead branches or stale compatibility code, and run focused regression tests plus the full typecheck, unit suite, production build, and relevant user-facing E2E scenarios.
- Include a database-load regression audit for every changed data workflow. Inspect client query lifecycles and server access paths for unstable query keys, refetch/invalidation loops, accidental polling, duplicate requests on mount/focus/reconnect, N+1 queries, database calls inside row loops, unbounded query fan-out, unnecessary full-table reads, and repeated dispatcher or derived-cache rebuilds.
- For affected representative workflows, add or run request/query-count regression coverage where practical. At minimum consider initial report loading, switching reports, opening the changed modal or details view, saving a mutation and refreshing its data, and focus/reconnect behavior. Assert bounded counts and, where relevant, that query growth is constant or batched rather than proportional to the number of rows. Prefer durable count/coalescing tests over timing-only benchmarks.
- Verify that expensive dispatcher refreshes are coalesced, scoped dirty-index updates remain scoped, filters do not trigger unrelated dispatcher rebuilds, and cache invalidation does not immediately refetch large inactive datasets.
- Never run load tests against the remote or production database without the user's explicit instruction. State which database-load checks were measured, which were reviewed statically, and any remaining performance gap that could not be exercised locally.

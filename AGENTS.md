# Agent Rules

## Git commits

- Never create a commit unless the user explicitly asks for one. Leave changes uncommitted for the user to review and commit.

## User guide

- Any new feature, rule change, renamed field, import behavior change, document-template behavior change, dispatcher logic change, or settings change must be accompanied by an update to the in-app user guide.
- The main guide is implemented in `src/components/user-guide-page.tsx`.
- Keep the guide user-facing: describe what the user sees, what to click, what the system checks, and practical cases.

## Database migrations

- Never write migration SQL files manually.
- Never run migrations from a non-main branch.
- Before running any migration, ask the user exactly: "могу ли я запустить миграцию". Run the migration only after the user gives an affirmative answer.
- Never run a migration without the user's direct permission.
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

- When the user says `Проведи полную предкоммитную проверку.`, treat it as a request for a risk-based audit of all uncommitted changes, not just a test-suite run. Review the complete diff, trace affected workflows end to end, check interactions with existing rules and settings, remove dead, duplicate, obsolete, or stale compatibility code, and run focused regression tests plus the full typecheck, unit suite, production build, and relevant user-facing E2E scenarios.
- Reconstruct the acceptance criteria from all user requests and the latest clarifications represented by the current changes, then verify each requirement against the implementation and observable user behavior. Do not assume that passing tests proves the requested logic. Look for missed requirements, stale assumptions, contradictory rules, inconsistent behavior between entry points, and regressions in adjacent workflows. If a material ambiguity or contradiction cannot be resolved safely from the existing rules, stop and ask the user how it should work instead of guessing.
- Perform an explicit gray-zone audit for affected workflows: empty, partial, legacy, and unusually large records; alternate entry points; repeated actions; cancellation and retry; stale or concurrent clients; intermediate workflow states; error recovery; and transitions between related document, LNK, PSTO, dispatcher, import, and edit flows. Add regression coverage for uncovered behavior and clean up unreachable or misleading branches discovered during the audit.
- Include a database-load regression audit for every changed data workflow. Inspect both client-to-server/RPC traffic and database statements, including requests hidden in hooks, effects, render lifecycles, event handlers, helper functions, and background jobs. Check for unstable query keys, refetch/invalidation loops, accidental polling, duplicate requests on mount/focus/reconnect, N+1 queries, database or server calls inside row loops, unbounded `Promise.all` or query fan-out, unnecessary full-table reads, oversized responses, and repeated dispatcher or derived-cache rebuilds.
- For affected representative workflows, add or run request/query-count regression coverage where practical. At minimum consider initial report loading, switching reports, opening the changed modal or details view, saving a mutation and refreshing its data, and focus/reconnect behavior. Assert bounded counts and, where relevant, that query growth is constant or batched rather than proportional to the number of rows. Prefer durable count/coalescing tests over timing-only benchmarks.
- Verify that expensive dispatcher refreshes are coalesced, scoped dirty-index updates remain scoped, filters do not trigger unrelated dispatcher rebuilds, and cache invalidation does not immediately refetch large inactive datasets.
- Treat approximately 200,000 weld joints as the normal scale target. For every affected path whose cost can grow with the number of joints, documents, tasks, or relations, either exercise it against the isolated local 200,000-joint benchmark database or provide an equivalent query-count and complexity check. A purely visual change does not require a load run, but it must not introduce a scalable request or render path.
- Run user-facing tests that reproduce the requested behavior and likely operator mistakes, not only low-level unit tests. For broad or cross-cutting changes, run the full user-facing E2E suite; for a narrowly scoped change, run every affected E2E scenario and state why the remaining scenarios are unrelated. Treat warnings, unhandled rejections, flaky behavior, and unexpected server logs as findings to investigate even when the test exits successfully.
- Never run load tests against the remote or production database without the user's explicit instruction. State which database-load checks were measured, which were reviewed statically, and any remaining performance gap that could not be exercised locally.
- Before declaring the changes ready to commit, report how every user requirement was verified, which automated and user-facing checks passed, any check that could not be run, all remaining risks or performance gaps, and whether schema or migration changes are present. Do not describe the changes as safe merely because the automated suite passed.

# Agent Rules

## Git commits

- Never create a commit unless the user explicitly asks for one. Leave changes uncommitted for the user to review and commit.

## Production boundary

- Read-only viewing of production is allowed when relevant to the user's task. Opening existing pages, searching, filtering, and viewing records are permitted only when they do not change stored state. This does not authorize production tests, load runs, or operational commands.
- Without a direct user instruction explicitly authorizing the specific production action, never create, edit, save, delete, or otherwise change production code, data, schema, settings, infrastructure, or documents. Do not run production migrations, maintenance commands, recalculations, or deployments under testing permission. If a viewing action might mutate stored state, inspect the local code first or ask the user instead of trying it on production.
- Do not push to a branch that triggers a production autodeploy. A general request to test, migrate, commit, or push does not lift this boundary; the user must explicitly change the production restriction first.
- Keep development and automated checks local. A local production-mode build is allowed; it must not connect to production services or databases.

## User-facing reports

- Keep both final messages and written reports concise and focused on what matters to the user: the result, important findings, remaining risks, unverified behavior, migration requirements, and any action or decision needed from the user.
- Put blockers and consequential limitations first. Give a brief verification summary; do not bury important details in exhaustive logs, technical chronology, large checklists, or repeated test statistics. Provide detailed diagnostics only when requested or necessary to explain a material issue.

## User guide

- Any new feature, rule change, renamed field, import behavior change, document-template behavior change, dispatcher logic change, or settings change must be accompanied by an update to the in-app user guide.
- The main guide is implemented in `src/components/user-guide-page.tsx`.
- Keep the guide user-facing: describe what the user sees, what to click, what the system checks, and practical cases.

## Database migrations

- Never write migration SQL files manually.
- Never run migrations from a non-main branch.
- Standing permission (user clarification, 2026-09-29): local migrations, including the main local working database and disposable local test databases, may run without asking again. Verify the local host and exact database name, review the generated migration, and preserve existing data. Do not request repeated permission for local/test migrations.
- Automated tests, synthetic fixtures, and load runs must still use a separate disposable local test database; verify its isolation and empty initial state before setup. Permission to migrate the main local database does not authorize replacing it, clearing it, or using it for destructive tests.
- Remote migrations, especially production migrations, require separate direct authorization for the specific action under the production boundary above. Local/testing permission never authorizes production migrations or other production changes.
- Treat `src/db/schema.ts` as the source of truth for database shape.
- For schema changes, update the Drizzle schema first, then generate migrations with `pnpm db:generate`.
- Review generated migrations before running them, but do not hand-author migration files.
- Apply local migrations with `pnpm db:migrate`.
- Only if remote work is explicitly authorized and does not violate the production boundary, apply remote migrations with `pnpm db:remote-migration`. This script uses `DATABASE_URL_REMOTE_FOR_MIGRATIONS`; never run `drizzle-kit migrate` directly against a remote database and never use the app's `DATABASE_URL` for remote migrations.

## Validation and dispatcher rules

- System-managed fields must never appear in the weld-joint create/edit form. Requests and request dates, LNK/PSTO results and conclusions, derived statuses, dispatcher data, service timestamps, and document assignments such as JSR, Checklist, and ZNI are changed only by their dedicated workflows and remain read-only in report tables. Add regression coverage whenever a new system-managed weld field is introduced.
- Import, mass-fill, and replacement validation must check the final record after imported values are merged with the stored weld joint. A partial update must not bypass a save check.
- When one import row has several simultaneously detectable field errors, report and highlight all of them together instead of stopping after the first field error. Add a regression test for combined errors whenever a new import validation can overlap another one.
- Any new or changed dispatcher rule that can affect existing weld joints must invalidate the persisted dispatcher calculation by incrementing `DISPATCHER_TASK_CALCULATION_VERSION` in `src/lib/dispatcher-task-index-payload.ts`.
- Every new ZV/DZ pair must have regression coverage for the form/server validation, dispatcher task code, persisted row index, and the virtual `dispatcherTasks` field for already stored weld joints.

## Business-rule and test-expectation audit

- Apply this check during full pre-commit audits and systemic/business-logic audits, including `Проведи комплексный системный аудит логики и масштабируемости.`. Check the validity of the business assumptions and test expectations, not just whether the implementation passes the existing tests.
- Derive expected behavior independently from the user's requirements and latest clarifications. Existing code, tests, fixtures, and guide text may all repeat the same mistaken assumption; their agreement is not independent evidence that the rule is correct. Identify consequential assumptions not supported by those requirements and ask the user when their resolution would change business behavior.
- Explicitly distinguish "not required" from "forbidden", a displayed waiting label or note from evidence of an actually started process, and an individual record's history from a line-wide or inherited state. Check that preserving historical work does not incorrectly exempt new records, block factual backfill, or hide rejected results.
- For the affected rules, challenge the normal path with small counterexample fixtures: records on the same line with different histories, setting off/on transitions, fresh versus legacy records, waiting-only or partial data, moved/repeated records, and missing historical documents. Trace the relevant cases through UI availability, server validation, SQL selection, saved state, and dispatcher/status calculations. Large load runs and high test counts do not replace these logical combinations.
- Where practical, reproduce a confirmed defect with a regression that fails before the fix. Do not change test expectations merely to match current code or obtain a passing suite; justify any corrected expectation by an established requirement or the user's clarification. State unresolved business assumptions briefly in the final report instead of declaring them verified.

## Full pre-commit audit

- Next-audit scope agreed on 2026-10-05: include the deferred real-production-backup restore/upgrade rehearsal, resource-limited mixed multiuser load, and a system-wide architecture/simplification review broader than the preliminary review on 2026-10-05. See the opening section of `docs/precommit-audit-2026-10-01.md` for prerequisites, scope, and the distinction between deferred and verified work. Run these checks locally; this agreement does not authorize obtaining backups from production or performing any production operation.
- Before the next pre-commit audit, read the agreed implementation plan in full and compare each requirement and exception with the actual implementation, tests, and user-visible states. For the line program, use `docs/line-program-plan-2026-09-25.md` plus the latest user clarifications. Record discrepancies; ask the user about material ambiguities before changing business behavior. In particular, an unreachable theoretical quota must not be reintroduced as an assignment debt through labels, counters, progress bars, or warnings.
- When the user says `Проведи полную предкоммитную проверку.`, treat it as a request for a risk-based audit of all uncommitted changes, not just a test-suite run. Review the complete diff, trace affected workflows end to end, check interactions with existing rules and settings, remove dead, duplicate, obsolete, or stale compatibility code, and run focused regression tests plus the full typecheck, unit suite, production build, and relevant user-facing E2E scenarios.
- Reconstruct the acceptance criteria from all user requests and the latest clarifications represented by the current changes, then verify each requirement against the implementation and observable user behavior. Do not assume that passing tests proves the requested logic. Look for missed requirements, stale assumptions, contradictory rules, inconsistent behavior between entry points, and regressions in adjacent workflows. If a material ambiguity or contradiction cannot be resolved safely from the existing rules, stop and ask the user how it should work instead of guessing.
- Perform an explicit gray-zone audit for affected workflows: empty, partial, legacy, and unusually large records; alternate entry points; repeated actions; cancellation and retry; stale or concurrent clients; intermediate workflow states; error recovery; and transitions between related document, LNK, PSTO, dispatcher, import, and edit flows. Add regression coverage for uncovered behavior and clean up unreachable or misleading branches discovered during the audit.
- Include a database-load regression audit for every changed data workflow. Inspect both client-to-server/RPC traffic and database statements, including requests hidden in hooks, effects, render lifecycles, event handlers, helper functions, and background jobs. Check for unstable query keys, refetch/invalidation loops, accidental polling, duplicate requests on mount/focus/reconnect, N+1 queries, database or server calls inside row loops, unbounded `Promise.all` or query fan-out, unnecessary full-table reads, oversized responses, and repeated dispatcher or derived-cache rebuilds.
- For affected representative workflows, add or run request/query-count regression coverage where practical. At minimum consider initial report loading, switching reports, opening the changed modal or details view, saving a mutation and refreshing its data, and focus/reconnect behavior. Assert bounded counts and, where relevant, that query growth is constant or batched rather than proportional to the number of rows. Prefer durable count/coalescing tests over timing-only benchmarks.
- Verify that expensive dispatcher refreshes are coalesced, scoped dirty-index updates remain scoped, filters do not trigger unrelated dispatcher rebuilds, and cache invalidation does not immediately refetch large inactive datasets.
- Treat approximately 200,000 weld joints as the normal scale target. For every affected path whose cost can grow with the number of joints, documents, tasks, or relations, either exercise it against the isolated local 200,000-joint benchmark database or provide an equivalent query-count and complexity check. A purely visual change does not require a load run, but it must not introduce a scalable request or render path.
- Run user-facing tests that reproduce the requested behavior and likely operator mistakes, not only low-level unit tests. For broad or cross-cutting changes, run the full user-facing E2E suite; for a narrowly scoped change, run every affected E2E scenario and state why the remaining scenarios are unrelated. Treat warnings, unhandled rejections, flaky behavior, and unexpected server logs as findings to investigate even when the test exits successfully.
- Never run load tests against production. Any non-production remote load test requires explicit authorization. Briefly distinguish measured database-load checks from static review and identify any remaining performance gap that could not be exercised locally.
- Before declaring the changes ready to commit, verify every user requirement, then give a concise outcome-focused summary of the checks passed, any checks not run, remaining risks or performance gaps, and schema or migration changes. Group related requirements instead of producing an exhaustive report by default. Do not describe the changes as safe merely because the automated suite passed.

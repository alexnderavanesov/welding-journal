# Agent Rules

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

- Import, mass-fill, and replacement validation must check the final record after imported values are merged with the stored weld joint. A partial update must not bypass a save check.
- When one import row has several simultaneously detectable field errors, report and highlight all of them together instead of stopping after the first field error. Add a regression test for combined errors whenever a new import validation can overlap another one.
- Any new or changed dispatcher rule that can affect existing weld joints must invalidate the persisted dispatcher calculation by incrementing `DISPATCHER_TASK_CALCULATION_VERSION` in `src/lib/dispatcher-task-index-payload.ts`.
- Every new ZV/DZ pair must have regression coverage for the form/server validation, dispatcher task code, persisted row index, and the virtual `dispatcherTasks` field for already stored weld joints.

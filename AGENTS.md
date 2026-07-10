# Agent Rules

## Database migrations

- Never write migration SQL files manually.
- Treat `src/db/schema.ts` as the source of truth for database shape.
- For schema changes, update the Drizzle schema first, then generate migrations with Drizzle CLI:
  - `drizzle-kit generate`
  - `drizzle-kit migrate`
- Review generated migrations before running them, but do not hand-author migration files.

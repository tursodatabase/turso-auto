# Conformance tests

Live tests that exercise `@tursodatabase/auto` against the real Turso API:
provision a database on first use, create a table, write, and read back.

These tests **create and delete a real database** in the configured group on
every run. They are skipped automatically when credentials are not set, so
`npm test` is safe to run anywhere.

## Running

```bash
cp conformance/.env.example conformance/.env
# edit conformance/.env with your token, org slug, and group

npm test            # or: npm run test:conformance
```

Tests run with [AVA](https://github.com/avajs/ava) (TypeScript via `tsx`).
`conformance/.env` is loaded automatically when present; no `.env` is needed
in CI — without credentials the suite simply skips.

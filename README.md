<p align="center">
  <a href="https://turso.tech/">
    <picture>
      <img src="/.github/assets/cover.png" alt="Turso" />
    </picture>
  </a>
  <h1 align="center">Millions of databases. Zero config.</h1>
</p>

<p align="center">
  Spin up a Turso database for every user, agent, and tenant &mdash; provisioned on demand, no dashboards. On Turso Cloud or your own infrastructure (BYOC).
</p>

<p align="center">
  <a href="https://turso.tech"><strong>Turso</strong></a> ·
  <a href="https://docs.turso.tech"><strong>Docs</strong></a> ·
  <a href="https://turso.tech/blog"><strong>Blog &amp; Tutorials</strong></a>
</p>

<p align="center">
  <a href="LICENSE">
    <picture>
      <img src="https://img.shields.io/github/license/tursodatabase/turso-vercel?color=0F624B" alt="MIT License" />
    </picture>
  </a>
  <a href="https://tur.so/discord-ts">
    <picture>
      <img src="https://img.shields.io/discord/933071162680958986?color=0F624B" alt="Discord" />
    </picture>
  </a>
  <a href="https://www.npmjs.com/package/@tursodatabase/auto">
    <picture>
      <img src="https://img.shields.io/npm/v/@tursodatabase/auto?color=0F624B" alt="npm version" />
    </picture>
  </a>
</p>

Name a database and start querying &mdash; it's provisioned the first time you touch it:

```ts
import { openDb, table, integer, text } from "@tursodatabase/auto";

// Declare the schema once — applied to every database automatically.
const schema = {
  memories: table({ id: integer().primaryKey(), content: text() }),
};

// One database per agent — provisioned and migrated on first use.
const db = await openDb(`agent-${agentId}`, { schema });

// `memories` already exists — just use it.
await db.execute(
  "INSERT INTO memories (content) VALUES (?)",
  ["User prefers concise answers."],
);
```

## Features

- **Zero-config provisioning** &mdash; Databases are created on first use. No dashboards, no setup steps.
- **A database for everyone** &mdash; Give every user, agent, or tenant their own database. Lightweight enough to multiply into millions.
- **Runs anywhere** &mdash; Connects to Turso over HTTP using only `fetch()` &mdash; serverless, edge, or long-running runtimes, with no native bindings.
- **Cloud or BYOC** &mdash; Works against Turso Cloud or your own infrastructure (Bring Your Own Cloud).

## Install

```bash
npm install @tursodatabase/auto
```

## Setup

1. Get your Turso API token:
   ```bash
   turso auth api-tokens mint my-app-token
   ```

2. Get your organization slug:
   ```bash
   turso org list
   ```

3. Create a database group for your app (or use an existing one):
   ```bash
   turso group create my-project
   ```

4. Set these environment variables for your app:
   ```
   TURSO_API_TOKEN=your-api-token
   TURSO_ORG=your-org-slug
   TURSO_GROUP=my-project
   ```

All databases are scoped to the configured group. You can create as many databases as you like within it, and they can only be created in and accessed from that group.

## Quickstart

```ts
import { openDb } from "@tursodatabase/auto";

// One database per tenant — provisioned automatically on first use.
const db = await openDb(`tenant-${tenantId}`);

// Create tables
await db.execute(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE
  )
`);

// Insert data
await db.execute(
  "INSERT INTO users (name, email) VALUES (?, ?)",
  ["Alice", "alice@example.com"]
);

// Query data
const result = await db.query("SELECT * FROM users");
console.log(result.rows);
```

## API Reference

See the [Manual](MANUAL.md) for the full API reference &mdash; `openDb` and its options, encryption, `db.query`, `db.execute`, `db.close` &mdash; and how schema migrations work.

## Documentation

Visit our [official documentation](https://docs.turso.tech) for more details.

## Support

Join us [on Discord](https://tur.so/discord-ts) to get help using this SDK. Report security issues [via email](mailto:security@turso.tech).

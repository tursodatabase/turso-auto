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
import { openDb } from "@tursodatabase/auto";

// One database per agent. Provisioned automatically.
const db = await openDb(`agent-${agentId}`);

// Give the agent something to remember
await db.execute(
  "INSERT INTO memories (content) VALUES (?)",
  ["User prefers concise answers."]
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

### `openDb(name, options?)`

Get a database by name, provisioning it in the configured group if it doesn't already exist. Returns the same instance for repeated calls with the same name.

```ts
const db = await openDb(`tenant-${tenantId}`);

// Connect to an existing database, without provisioning a new one
const db = await openDb(`tenant-${tenantId}`, { create: false });
```

**Options**

- `create` (default `true`) &mdash; Provision the database if it does not already exist. Pass `false` to require that it already exists (throws otherwise).
- `encryption` &mdash; Encrypt the database at rest with a key you control. See [Encryption](#encryption) below.

> **Important:** Derive database names from a trusted, authenticated identifier &mdash; such as the session's user or tenant ID &mdash; never from raw client input. All access is scoped to the configured group, so a leaked or injected name can at most reach other databases within that same group.

#### Encryption

Pass an `encryption` key to store the database encrypted at rest. The database is provisioned as encrypted on first use, and the key is supplied on every query thereafter.

```ts
const db = await openDb(`tenant-${tenantId}`, {
  encryption: { key: process.env.TENANT_KEY },
});
```

- `key` &mdash; Base64-encoded encryption key. Key size depends on the cipher: 32 bytes for `aes256gcm`, `chacha20poly1305`, and `aegis256` variants; 16 bytes for `aes128gcm` and `aegis128l` variants.
- `cipher` (default `"aes256gcm"`) &mdash; One of `aes256gcm`, `aes128gcm`, `chacha20poly1305`, `aegis128l`, `aegis128x2`, `aegis128x4`, `aegis256`, `aegis256x2`, `aegis256x4`.

> **Important:** Bring your own key &mdash; derive it from a trusted secret store such as a KMS, never from client input. The key is set when the database is provisioned and must be supplied on every open afterwards; opening an existing encrypted database without the matching key fails. Encryption cannot be added to a database that was already provisioned without it.

### `db.query(sql, params?)`

Execute a SELECT query and return results.

```ts
const result = await db.query(
  "SELECT * FROM users WHERE id = ?",
  [1]
);

console.log(result.columns); // ["id", "name", "email"]
console.log(result.rows);    // [[1, "Alice", "alice@example.com"]]
```

### `db.execute(sql, params?)`

Execute an INSERT, UPDATE, DELETE, or DDL statement.

```ts
await db.execute(
  "UPDATE users SET name = ? WHERE id = ?",
  ["Bob", 1]
);
```

### `db.close()`

Close the connection to the remote Turso database, releasing the server-side stream.

```ts
await db.close();
```

## Documentation

Visit our [official documentation](https://docs.turso.tech) for more details.

## Support

Join us [on Discord](https://tur.so/discord-ts) to get help using this SDK. Report security issues [via email](mailto:security@turso.tech).

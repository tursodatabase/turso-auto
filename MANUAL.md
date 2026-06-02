# Manual

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
- `schema` &mdash; A declared schema that is reconciled against the database on open. See [Migrations](#migrations) below.
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

## Migrations

`@tursodatabase/auto` has no migration files, no version numbers, and no
`migrate` step. You declare a schema in TypeScript and pass it to `openDb`. On
open, the library compares your **declared schema** (the desired state) against
the **actual database** and applies the difference. That's the whole model.

```ts
const schema = {
  memories: table({ id: integer().primaryKey(), content: text() }),
};

const db = await openDb(`agent-${agentId}`, { schema });
```

### The reconciliation is additive

Reconciliation only ever **adds**: it creates missing tables and adds missing
columns. It never drops, renames, or retypes anything. **No reconciliation can
destroy data.** This is a deliberate constraint, not a missing feature, and it
exists because of how this library is used:

- **Databases are provisioned lazily**, at different times. A database created
  last month and one created a second ago are at whatever schema each last saw.
- **The fleet runs mixed versions during a rollout.** Old and new application
  code touch databases at different schema states simultaneously. A destructive
  change applied automatically would break whichever side wasn't expecting it.
- **`ALTER TABLE ... ADD COLUMN` is the only safe, universally-applicable DDL.**
  Any column you declare may end up being added to an already-populated database,
  so the column builders refuse shapes `ADD COLUMN` cannot apply.

### What happens for each kind of change

"Desired" is what your schema declares; "actual" is what the database already
has.

| Change (desired vs. actual)                     | Behavior      | Notes |
| ----------------------------------------------- | ------------- | ----- |
| Table in schema, not in database                | **CREATE**    | Full DDL — primary keys and `NOT NULL` allowed here. |
| Nullable column added to schema                 | **ADD COLUMN**| Existing rows get `NULL`. |
| Column with a constant default added            | **ADD COLUMN**| Existing rows get the default. |
| `NOT NULL` column **with** a default added      | **ADD COLUMN**| Existing rows get the default. |
| Identical schema reopened                       | **no-op**     | No writes; data untouched. |
| Column removed from schema                       | **no-op**     | The column and its data stay in the database. |
| Table removed from schema                        | **no-op**     | The table and its data stay. |
| Column renamed in schema                         | **add only**  | Seen as "drop old + add new" → the new column is added (empty); the old one stays. Data is **not** copied. |
| Column's type changed in schema                  | **no-op**     | Existing column is left as-is; the mismatch is not detected. |
| Constraint tightened (e.g. add `NOT NULL`)       | **no-op**     | Existing column is left as-is; constraints are not altered. |
| `NOT NULL` column **without** a default added    | **rejected**  | Compile-time *and* runtime error — `ADD COLUMN NOT NULL` needs a default. |
| Primary-key column added to an existing table    | **rejected**  | Runtime error — a primary key must exist when the table is created. |
| `autoIncrement` on a non-integer / non-PK column | **rejected**  | Runtime error from `table(...)`. |

The takeaway: **additive changes happen automatically; non-additive changes are
ignored, not rejected** (except the few shapes that can't even be expressed).
Nothing you do to the schema can delete data.

### Rules the API enforces

These are checked when you call `table(...)`, and the first two are also
enforced by the type system before the code even runs:

1. **`NOT NULL` columns must declare a constant `.default(...)`** (or be the
   primary key). A `NOT NULL` column with no default can't be added to a table
   that already has rows.
2. **Primary keys are declared with `.primaryKey()` at table creation.** A
   primary key can't be added to an existing table later.
3. **Defaults are constants, not expressions.** `ADD COLUMN` forbids
   `CURRENT_TIMESTAMP`, `(expr)`, etc. For "now"-style values, set them in your
   `INSERT` or make the column nullable.
4. **`autoIncrement` requires an integer primary key.**

### Making non-additive changes safely

When you genuinely need to rename, drop, retype, or backfill, do it as a
deliberate, staged change — never in one automatic step across a live fleet.
The pattern is **expand / contract**:

- **Rename `a` → `b`:** add `b` (expand), backfill `b` from `a`, switch the app
  to read `b`, and only much later — once nothing reads `a` — drop `a`.
- **Drop a column:** just remove it from the schema. Reconciliation leaves it in
  place (a harmless no-op). If you truly need the storage back, drop it by hand
  via the escape hatch below.
- **Change a type:** add a new column of the new type, backfill, switch over,
  retire the old column.

### Escape hatch

For anything reconciliation deliberately won't do — a hand-written destructive
migration, or a full migration tool like Drizzle — reach for the underlying
connection:

```ts
const db = await openDb(name, { schema });
await db.connection.execute("ALTER TABLE memories DROP COLUMN obsolete");
```

### Current limitations

- **Indexes and `UNIQUE` constraints are not yet reconciled.** Declare them by
  hand through `db.connection` for now.
- **Type and constraint mismatches on existing columns are not detected** — they
  are silently left as-is (see the table above).

import test from "ava";
import { randomUUID } from "node:crypto";
import { openDb, table, integer, text } from "../src/index.ts";
import { deleteDb, hasCredentials } from "./utils.ts";

// Live schema-reconciliation conformance tests. Skipped automatically unless
// TURSO_API_TOKEN, TURSO_ORG, and TURSO_GROUP are set (see .env.example).
// Each test name maps to a row of the behavior matrix in MANUAL.md.
const schemaTest = hasCredentials ? test : test.skip;

const uniqueName = () => `conformance-schema-${randomUUID().slice(0, 8)}`;

// ---------------------------------------------------------------------------
// Additive: CREATE and ADD COLUMN
// ---------------------------------------------------------------------------

schemaTest("CREATE: materializes every declared table on first open", async (t) => {
  const name = uniqueName();
  t.teardown(() => deleteDb(name));

  const db = await openDb(name, {
    schema: {
      users: table({ id: integer().primaryKey({ autoIncrement: true }), name: text() }),
      notes: table({ id: integer().primaryKey({ autoIncrement: true }), body: text() }),
    },
  });
  await db.execute("INSERT INTO users (name) VALUES (?)", ["alice"]);
  await db.execute("INSERT INTO notes (body) VALUES (?)", ["hello"]);
  const users = await db.query("SELECT name FROM users");
  const notes = await db.query("SELECT body FROM notes");
  await db.close();

  t.deepEqual(users.rows, [["alice"]]);
  t.deepEqual(notes.rows, [["hello"]]);
});

schemaTest("ADD COLUMN: adds a nullable column, existing rows read NULL", async (t) => {
  const name = uniqueName();
  t.teardown(() => deleteDb(name));

  const v1 = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        content: text().notNull().default(""),
      }),
    },
  });
  await v1.execute("INSERT INTO memories (content) VALUES (?)", ["remember this"]);
  await v1.close();

  const v2 = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        content: text().notNull().default(""),
        tag: text(),
      }),
    },
  });
  const rows = await v2.query("SELECT content, tag FROM memories");
  await v2.close();

  t.deepEqual(rows.columns, ["content", "tag"]);
  t.deepEqual(rows.rows, [["remember this", null]]);
});

schemaTest("ADD COLUMN: defaults backfill existing rows (nullable and NOT NULL)", async (t) => {
  const name = uniqueName();
  t.teardown(() => deleteDb(name));

  const v1 = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        content: text().notNull().default(""),
      }),
    },
  });
  await v1.execute("INSERT INTO memories (content) VALUES (?)", ["old row"]);
  await v1.close();

  const v2 = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        content: text().notNull().default(""),
        score: integer().notNull().default(0), // NOT NULL + default
        label: text().default("none"), // nullable + default
      }),
    },
  });
  const rows = await v2.query("SELECT content, score, label FROM memories");
  await v2.close();

  t.deepEqual(rows.rows, [["old row", 0, "none"]]);
});

// ---------------------------------------------------------------------------
// No-op: identical, removals, rename, type/constraint changes
// ---------------------------------------------------------------------------

schemaTest("no-op: reopening with an identical schema preserves data", async (t) => {
  const name = uniqueName();
  t.teardown(() => deleteDb(name));

  const schema = {
    memories: table({
      id: integer().primaryKey({ autoIncrement: true }),
      content: text().notNull().default(""),
    }),
  };

  const first = await openDb(name, { schema });
  await first.execute("INSERT INTO memories (content) VALUES (?)", ["one"]);
  await first.close();

  const second = await openDb(name, { schema });
  const rows = await second.query("SELECT content FROM memories");
  await second.close();

  t.deepEqual(rows.rows, [["one"]]);
});

schemaTest("no-op: removing a column from the schema leaves it (and its data)", async (t) => {
  const name = uniqueName();
  t.teardown(() => deleteDb(name));

  const v1 = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        content: text().notNull().default(""),
        tag: text(),
      }),
    },
  });
  await v1.execute("INSERT INTO memories (content, tag) VALUES (?, ?)", ["body", "work"]);
  await v1.close();

  // `tag` is gone from the declaration — reconciliation must not drop it.
  const v2 = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        content: text().notNull().default(""),
      }),
    },
  });
  const rows = await v2.query("SELECT content, tag FROM memories");
  await v2.close();

  t.deepEqual(rows.rows, [["body", "work"]]);
});

schemaTest("no-op: removing a table from the schema leaves it (and its data)", async (t) => {
  const name = uniqueName();
  t.teardown(() => deleteDb(name));

  const v1 = await openDb(name, {
    schema: {
      memories: table({ id: integer().primaryKey({ autoIncrement: true }), content: text() }),
      archived: table({ id: integer().primaryKey({ autoIncrement: true }), content: text() }),
    },
  });
  await v1.execute("INSERT INTO archived (content) VALUES (?)", ["kept"]);
  await v1.close();

  // `archived` is gone from the declaration — reconciliation must not drop it.
  const v2 = await openDb(name, {
    schema: {
      memories: table({ id: integer().primaryKey({ autoIncrement: true }), content: text() }),
    },
  });
  const rows = await v2.query("SELECT content FROM archived");
  await v2.close();

  t.deepEqual(rows.rows, [["kept"]]);
});

schemaTest("add only: a 'rename' adds the new column and keeps the old", async (t) => {
  const name = uniqueName();
  t.teardown(() => deleteDb(name));

  const v1 = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        content: text().notNull().default(""),
      }),
    },
  });
  await v1.execute("INSERT INTO memories (content) VALUES (?)", ["hello"]);
  await v1.close();

  // `content` "renamed" to `body`: the new column is added empty; `content`
  // and its data remain. Data is NOT copied across.
  const v2 = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        body: text(),
      }),
    },
  });
  const rows = await v2.query("SELECT content, body FROM memories");
  await v2.close();

  t.deepEqual(rows.rows, [["hello", null]]);
});

schemaTest("no-op: a changed column type is left as-is", async (t) => {
  const name = uniqueName();
  t.teardown(() => deleteDb(name));

  const v1 = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        value: text(),
      }),
    },
  });
  await v1.execute("INSERT INTO memories (value) VALUES (?)", ["42"]);
  await v1.close();

  // `value` is now declared as integer — the existing column is untouched.
  const v2 = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        value: integer(),
      }),
    },
  });
  const info = await v2.query("PRAGMA table_info(memories)");
  const rows = await v2.query("SELECT value FROM memories");
  await v2.close();

  // Declared type did not overwrite the live column type, and the value reads back unchanged.
  const valueType = info.rows.find((row) => row[1] === "value")?.[2];
  t.is(valueType, "TEXT");
  t.deepEqual(rows.rows, [["42"]]);
});

schemaTest("no-op: tightening a constraint to NOT NULL is not applied", async (t) => {
  const name = uniqueName();
  t.teardown(() => deleteDb(name));

  const v1 = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        content: text(), // nullable
      }),
    },
  });
  await v1.execute("INSERT INTO memories (content) VALUES (NULL)");
  await v1.close();

  // `content` is now declared NOT NULL — but the existing column (and its NULL
  // row) is left as-is; the constraint is not retrofitted.
  const v2 = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        content: text().notNull().default(""),
      }),
    },
  });
  const rows = await v2.query("SELECT content FROM memories");
  await v2.close();

  t.deepEqual(rows.rows, [[null]]);
});

// ---------------------------------------------------------------------------
// Rejected
// ---------------------------------------------------------------------------

// Pure definition-time guards — no database required, so these always run.
test("rejected: a NOT NULL column without a default throws at table()", (t) => {
  t.throws(
    () =>
      table({
        id: integer().primaryKey(),
        // @ts-expect-error the type system also rejects this shape
        content: text().notNull(),
      }),
    { message: /NOT NULL/ },
  );
});

test("rejected: autoIncrement on a non-integer primary key throws at table()", (t) => {
  t.throws(() => table({ id: text().primaryKey({ autoIncrement: true }) }), {
    message: /autoIncrement/,
  });
});

schemaTest("rejected: adding a primary key column to an existing table", async (t) => {
  const name = uniqueName();
  t.teardown(() => deleteDb(name));

  // A table created without a primary key.
  const v1 = await openDb(name, {
    schema: { memories: table({ content: text().notNull().default("") }) },
  });
  await v1.close();

  // Declaring a primary key column now would need ADD COLUMN ... PRIMARY KEY,
  // which SQLite forbids — reconciliation rejects it with a clear error.
  await t.throwsAsync(
    () =>
      openDb(name, {
        schema: {
          memories: table({
            id: integer().primaryKey({ autoIncrement: true }),
            content: text().notNull().default(""),
          }),
        },
      }),
    { message: /primary key/i },
  );
});

// ---------------------------------------------------------------------------
// Escape hatch
// ---------------------------------------------------------------------------

schemaTest("escape hatch: db.connection runs manual destructive DDL", async (t) => {
  const name = uniqueName();
  t.teardown(() => deleteDb(name));

  const db = await openDb(name, {
    schema: {
      memories: table({
        id: integer().primaryKey({ autoIncrement: true }),
        content: text().notNull().default(""),
        obsolete: text(),
      }),
    },
  });
  await db.execute("INSERT INTO memories (content, obsolete) VALUES (?, ?)", ["keep", "drop me"]);

  // Reconciliation never drops; the raw connection can.
  await db.connection.execute("ALTER TABLE memories DROP COLUMN obsolete");
  const info = await db.query("PRAGMA table_info(memories)");
  const rows = await db.query("SELECT content FROM memories");
  await db.close();

  const columns = info.rows.map((row) => row[1]);
  t.false(columns.includes("obsolete"));
  t.deepEqual(rows.rows, [["keep"]]);
});

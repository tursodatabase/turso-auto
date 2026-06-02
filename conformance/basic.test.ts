import test from "ava";
import { randomUUID } from "node:crypto";
import { openDb } from "../src/index.ts";
import { deleteDb, hasCredentials } from "./utils.ts";

// Live conformance test against the real Turso API. Skipped automatically
// unless TURSO_API_TOKEN, TURSO_ORG, and TURSO_GROUP are set (see .env.example).
const conformanceTest = hasCredentials ? test : test.skip;

conformanceTest("provisions a database lazily and reuses it on reopen", async (t) => {
  const name = `conformance-${randomUUID().slice(0, 8)}`;
  t.teardown(() => deleteDb(name));

  // First open provisions the database on first use; write some data, then
  // drop the connection.
  const first = await openDb(name);
  await first.execute(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE
    )
  `);
  await first.execute("INSERT INTO users (name, email) VALUES (?, ?)", [
    "Alice",
    "alice@example.com",
  ]);
  await first.close();

  // Reopening must connect to the same database, not provision a fresh one:
  // the data written above is still there.
  const second = await openDb(name);
  const users = await second.query("SELECT id, name, email FROM users");
  await second.close();

  t.deepEqual(users.columns, ["id", "name", "email"]);
  t.deepEqual(users.rows, [[1, "Alice", "alice@example.com"]]);
});

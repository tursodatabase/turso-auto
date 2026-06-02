import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@tursodatabase/api";

// Load conformance/.env into process.env when present (a no-op in CI).
const envFile = join(dirname(fileURLToPath(import.meta.url)), ".env");
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const { TURSO_API_TOKEN, TURSO_ORG, TURSO_GROUP } = process.env;

/** Whether the live Turso credentials needed to run the suite are configured. */
export const hasCredentials = Boolean(TURSO_API_TOKEN && TURSO_ORG && TURSO_GROUP);

/** Delete a database provisioned during a test. Only called when credentials exist. */
export async function deleteDb(name: string): Promise<void> {
  const client = createClient({ org: TURSO_ORG!, token: TURSO_API_TOKEN! });
  await client.databases.delete(name);
}

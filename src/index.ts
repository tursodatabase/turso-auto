import { createClient } from "@tursodatabase/api";
import { connect, type Connection } from "@tursodatabase/serverless";

// ============================================================================
// Types
// ============================================================================

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
}

export interface DatabaseOptions {
  /** Provision the database if it does not already exist. Default: true. */
  create?: boolean;
}

interface Credentials {
  url: string;
  authToken: string;
}

// ============================================================================
// State
// ============================================================================

const instances = new Map<string, Promise<TursoDatabase>>();
const credentials = new Map<string, Credentials>();

let apiClient: ReturnType<typeof createClient> | null = null;
let apiClientOrg: string | null = null;
let cachedGroupToken: { group: string; jwt: string } | null = null;

// ============================================================================
// Database Class
// ============================================================================

export class TursoDatabase {
  readonly name: string;
  private conn: Connection;

  private constructor(name: string, conn: Connection) {
    this.name = name;
    this.conn = conn;
  }

  static open(name: string, url: string, authToken: string): TursoDatabase {
    return new TursoDatabase(name, connect({ url, authToken }));
  }

  async query(sql: string, params?: unknown[]): Promise<QueryResult> {
    const result = await this.conn.execute(sql, params ?? []);
    return {
      columns: result.columns,
      rows: result.rows.map((row: unknown[]) => [...row]),
    };
  }

  async execute(sql: string, params?: unknown[]): Promise<void> {
    await this.conn.execute(sql, params ?? []);
  }

  async close(): Promise<void> {
    instances.delete(this.name);
    await this.conn.close();
  }
}

// ============================================================================
// Public API
// ============================================================================

export function openDb(name: string, options?: DatabaseOptions): Promise<TursoDatabase> {
  const existing = instances.get(name);
  if (existing) return existing;

  const promise = initDb(name, options);
  instances.set(name, promise);
  promise.catch(() => instances.delete(name));

  return promise;
}

// ============================================================================
// Internals
// ============================================================================

async function initDb(name: string, options?: DatabaseOptions): Promise<TursoDatabase> {
  const creds = await ensureDb(name, options?.create !== false);
  return TursoDatabase.open(name, creds.url, creds.authToken);
}

async function ensureDb(name: string, create: boolean): Promise<Credentials> {
  const cached = credentials.get(name);
  if (cached) return cached;

  const client = getClient();
  const group = requireEnv("TURSO_GROUP");
  let db: { hostname?: string } | undefined;

  try {
    db = await client.databases.get(name);
  } catch (err) {
    if (isNotFound(err)) {
      if (!create) {
        throw new Error(`Database "${name}" does not exist (pass { create: true } to provision it)`);
      }
      db = await client.databases.create(name, { group });
    } else {
      throw err;
    }
  }

  if (!db?.hostname) {
    throw new Error(`Failed to get hostname for database: ${name}`);
  }

  if (!cachedGroupToken || cachedGroupToken.group !== group) {
    const token = await client.groups.createToken(group, { authorization: "full-access" });
    cachedGroupToken = { group, jwt: token.jwt };
  }

  const creds: Credentials = { url: `libsql://${db.hostname}`, authToken: cachedGroupToken.jwt };
  credentials.set(name, creds);

  return creds;
}

function getClient(): ReturnType<typeof createClient> {
  const org = requireEnv("TURSO_ORG");

  if (!apiClient || apiClientOrg !== org) {
    apiClient = createClient({ org, token: requireEnv("TURSO_API_TOKEN") });
    apiClientOrg = org;
  }

  return apiClient;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required`);
  return value;
}

function isNotFound(err: unknown): boolean {
  return err instanceof Error && "status" in err && (err as { status: number }).status === 404;
}

// Backwards compatibility alias
export { TursoDatabase as VercelDatabase };

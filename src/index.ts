import { createClient } from "@tursodatabase/api";
import { connect, type Connection } from "@tursodatabase/serverless";

// ============================================================================
// Types
// ============================================================================

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
}

/** Cipher used to encrypt the database at rest. */
export type EncryptionCipher =
  | "aes256gcm"
  | "aes128gcm"
  | "chacha20poly1305"
  | "aegis128l"
  | "aegis128x2"
  | "aegis128x4"
  | "aegis256"
  | "aegis256x2"
  | "aegis256x4";

export interface EncryptionOptions {
  /**
   * Base64-encoded encryption key. Key size depends on the cipher: 32 bytes
   * for aes256gcm, chacha20poly1305 and aegis256 variants; 16 bytes for
   * aes128gcm and aegis128l variants.
   *
   * Bring your own key: derive it from a trusted secret store (e.g. a KMS),
   * never from client input. The key is set when the database is provisioned
   * and must be supplied on every open thereafter.
   */
  key: string;
  /** Cipher to encrypt the database with. Default: "aes256gcm". */
  cipher?: EncryptionCipher;
}

export interface DatabaseOptions {
  /** Provision the database if it does not already exist. Default: true. */
  create?: boolean;
  /**
   * Encrypt the database at rest with a key you control. Provisions the
   * database as encrypted on first use, and supplies the key on every query.
   * Opening an existing encrypted database without the matching key fails.
   */
  encryption?: EncryptionOptions;
}

const DEFAULT_CIPHER: EncryptionCipher = "aes256gcm";

/** Database creation options. Mirrors `@tursodatabase/api` (>= 2.0). */
interface CreateOptions {
  group: string;
  remote_encryption?: {
    encryption_key: string;
    encryption_cipher: EncryptionCipher;
  };
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

  static open(
    name: string,
    url: string,
    authToken: string,
    encryptionKey?: string,
  ): TursoDatabase {
    return new TursoDatabase(name, connect({ url, authToken, remoteEncryptionKey: encryptionKey }));
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
  const creds = await ensureDb(name, options?.create !== false, options?.encryption);
  return TursoDatabase.open(name, creds.url, creds.authToken, options?.encryption?.key);
}

async function ensureDb(
  name: string,
  create: boolean,
  encryption?: EncryptionOptions,
): Promise<Credentials> {
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
      const createOptions: CreateOptions = { group };
      if (encryption) {
        createOptions.remote_encryption = {
          encryption_key: encryption.key,
          encryption_cipher: encryption.cipher ?? DEFAULT_CIPHER,
        };
      }
      db = await client.databases.create(name, createOptions);
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

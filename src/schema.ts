import type { Connection } from "@tursodatabase/serverless";

// ============================================================================
// Schema
// ============================================================================
//
// A schema is declared in TypeScript and reconciled into each database on open.
// Reconciliation is *additive*: the library creates missing tables and adds
// missing columns, but never drops, renames, or retypes anything. Because a
// database is provisioned lazily, any column may end up being added to an
// already-existing database via `ALTER TABLE ... ADD COLUMN`. SQLite places
// hard limits on what that statement can do, so the column builders refuse to
// express the shapes it cannot apply — most importantly, a `NOT NULL` column
// must carry a constant `DEFAULT`.

/** SQLite storage class a column maps to. */
type SqlType = "integer" | "text" | "real" | "blob";

/** A constant usable as a column default (no expressions: `ADD COLUMN` forbids them). */
type DefaultValue = string | number | bigint | boolean | null;

interface ColumnDef {
  type: SqlType;
  /** Column name in SQL; defaults to the schema key when omitted. */
  name?: string;
  notNull: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  hasDefault: boolean;
  default?: DefaultValue;
}

/** Type-level flags tracked as a column is built up, used to enforce the rules. */
interface ColumnState {
  notNull: boolean;
  hasDefault: boolean;
  primaryKey: boolean;
}

type InitialState = { notNull: false; hasDefault: false; primaryKey: false };

/**
 * A column definition. Build one with {@link integer}, {@link text},
 * {@link real}, or {@link blob}, then refine it with `.notNull()`,
 * `.default(...)`, and `.primaryKey()`.
 */
export class Column<S extends ColumnState = InitialState> {
  /** @internal */
  readonly _def: ColumnDef;
  /** @internal phantom type carrier — never set at runtime. */
  declare readonly _state: S;

  /** @internal */
  constructor(def: ColumnDef) {
    this._def = def;
  }

  /** Disallow NULL. A `NOT NULL` column must also have a `.default(...)`. */
  notNull(): Column<Omit<S, "notNull"> & { notNull: true }> {
    return new Column({ ...this._def, notNull: true });
  }

  /** Set a constant default value. Expressions are not allowed (see above). */
  default(value: DefaultValue): Column<Omit<S, "hasDefault"> & { hasDefault: true }> {
    return new Column({ ...this._def, hasDefault: true, default: value });
  }

  /** Mark as the primary key. Implies `NOT NULL`. Only valid at table creation. */
  primaryKey(
    options?: { autoIncrement?: boolean },
  ): Column<Omit<S, "primaryKey" | "notNull"> & { primaryKey: true; notNull: true }> {
    return new Column({
      ...this._def,
      primaryKey: true,
      notNull: true,
      autoIncrement: options?.autoIncrement ?? false,
    });
  }
}

/** An integer column. Pass a name to override the SQL column name. */
export const integer = (name?: string): Column => new Column(baseDef("integer", name));
/** A text column. Pass a name to override the SQL column name. */
export const text = (name?: string): Column => new Column(baseDef("text", name));
/** A real (floating-point) column. Pass a name to override the SQL column name. */
export const real = (name?: string): Column => new Column(baseDef("real", name));
/** A blob column. Pass a name to override the SQL column name. */
export const blob = (name?: string): Column => new Column(baseDef("blob", name));

function baseDef(type: SqlType, name?: string): ColumnDef {
  return { type, name, notNull: false, primaryKey: false, autoIncrement: false, hasDefault: false };
}

/** Carries a human-readable reason a column was rejected at compile time. */
type ColumnError<Msg extends string> = { readonly __schemaError: Msg };

/**
 * A `NOT NULL` column with no default and no primary key cannot be added to an
 * existing table, so it is rejected at the type level.
 */
type ValidColumn<C> = C extends Column<infer S>
  ? S["notNull"] extends true
    ? S["hasDefault"] extends true
      ? C
      : S["primaryKey"] extends true
        ? C
        : ColumnError<"NOT NULL column requires a constant .default(...) (or .primaryKey())">
    : C
  : never;

export interface Table<Cols extends Record<string, Column<any>> = Record<string, Column<any>>> {
  readonly columns: Cols;
}

/** A schema is a plain map of table name to {@link table} definition. */
export type Schema = Record<string, Table>;

/**
 * Define a table from a map of column name to column definition.
 *
 * ```ts
 * const memories = table({
 *   id:      integer().primaryKey({ autoIncrement: true }),
 *   content: text().notNull().default(""),
 *   tag:     text(),
 * });
 * ```
 *
 * `NOT NULL` columns must declare a constant `.default(...)` — this is enforced
 * both at compile time and at runtime, because the column may later be added to
 * an already-provisioned database.
 */
export function table<Cols extends Record<string, Column<any>>>(
  columns: Cols & { [K in keyof Cols]: ValidColumn<Cols[K]> },
): Table<Cols> {
  for (const [key, column] of Object.entries(columns) as [string, Column][]) {
    const def = column._def;
    if (def.notNull && !def.hasDefault && !def.primaryKey) {
      throw new Error(
        `Column "${key}": NOT NULL columns must declare a constant .default(...) (or be .primaryKey()).`,
      );
    }
    if (def.autoIncrement && (def.type !== "integer" || !def.primaryKey)) {
      throw new Error(`Column "${key}": autoIncrement requires an integer primary key.`);
    }
  }
  return { columns } as Table<Cols>;
}

// ============================================================================
// Reconciliation
// ============================================================================

/**
 * Bring `conn`'s database up to `schema` by applying the additive difference:
 * create missing tables and add missing columns, atomically. Existing columns
 * are never altered. A database already matching the schema does no writes.
 */
export async function reconcileSchema(conn: Connection, schema: Schema): Promise<void> {
  // Two attempts: a concurrent first-open in another process can add a column
  // between our read and our write. On that benign collision we re-plan against
  // the now-current database and apply whatever remains.
  for (let attempt = 0; attempt < 2; attempt++) {
    const statements = await planSchema(conn, schema);
    if (statements.length === 0) return;
    try {
      await conn.batch(statements, "immediate");
      return;
    } catch (err) {
      if (attempt === 0 && isBenignSchemaCollision(err)) continue;
      throw err;
    }
  }
}

async function planSchema(conn: Connection, schema: Schema): Promise<string[]> {
  const existingTables = await tableNames(conn);
  const statements: string[] = [];

  for (const [tableName, def] of Object.entries(schema)) {
    if (!existingTables.has(tableName)) {
      statements.push(createTableDdl(tableName, def));
      continue;
    }

    const existingColumns = await columnNames(conn, tableName);
    for (const [key, column] of Object.entries(def.columns)) {
      const columnName = column._def.name ?? key;
      if (existingColumns.has(columnName)) continue;
      if (column._def.primaryKey) {
        throw new Error(
          `Cannot add primary key column "${columnName}" to existing table "${tableName}": ` +
            `primary keys must be declared when the table is first created.`,
        );
      }
      statements.push(
        `ALTER TABLE ${quoteId(tableName)} ADD COLUMN ${columnDdl(columnName, column._def)}`,
      );
    }
  }

  return statements;
}

async function tableNames(conn: Connection): Promise<Set<string>> {
  const result = await conn.execute(
    "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    [],
  );
  return new Set(result.rows.map((row: any) => String(row[0] ?? row.name)));
}

async function columnNames(conn: Connection, tableName: string): Promise<Set<string>> {
  const result = await conn.execute(`PRAGMA table_info(${quoteId(tableName)})`, []);
  return new Set(result.rows.map((row: any) => String(row[1] ?? row.name)));
}

// --- DDL generation -------------------------------------------------------

function quoteId(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}

function quoteLiteral(value: DefaultValue): string {
  if (value === null) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return `'${value.replace(/'/g, "''")}'`;
}

function columnDdl(name: string, def: ColumnDef): string {
  let ddl = `${quoteId(name)} ${def.type.toUpperCase()}`;
  if (def.primaryKey) {
    ddl += def.autoIncrement ? " PRIMARY KEY AUTOINCREMENT" : " PRIMARY KEY";
  } else if (def.notNull) {
    ddl += " NOT NULL";
  }
  if (def.hasDefault) {
    ddl += ` DEFAULT ${quoteLiteral(def.default ?? null)}`;
  }
  return ddl;
}

function createTableDdl(name: string, def: Table): string {
  const columns = Object.entries(def.columns).map(([key, column]) =>
    columnDdl(column._def.name ?? key, column._def),
  );
  return `CREATE TABLE IF NOT EXISTS ${quoteId(name)} (${columns.join(", ")})`;
}

function isBenignSchemaCollision(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const message = err.message.toLowerCase();
  return message.includes("duplicate column") || message.includes("already exists");
}

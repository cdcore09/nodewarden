// Minimal D1Database shim over node:sqlite for repo-level tests.
// Implements only what NodeWarden's repos use: prepare/bind/first/all/run, batch, exec.
import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_STATEMENTS } from '../src/services/storage-schema';

class ShimStatement {
  constructor(private db: DatabaseSync, private sql: string, private params: unknown[] = []) {}
  bind(...params: unknown[]): ShimStatement {
    return new ShimStatement(this.db, this.sql, params);
  }
  async first<T = unknown>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...(this.params as any[]));
    return (row as T) ?? null;
  }
  async all<T = unknown>(): Promise<{ results: T[]; success: true; meta: {} }> {
    const rows = this.db.prepare(this.sql).all(...(this.params as any[]));
    return { results: rows as T[], success: true, meta: {} };
  }
  async run(): Promise<{ success: true; meta: { changes: number } }> {
    const info = this.db.prepare(this.sql).run(...(this.params as any[]));
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

export function createTestDb(): any {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  // Apply config table, matching ensureStorageSchema() line 204
  try {
    db.exec('CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  } catch {
    /* ignore idempotent errors */
  }
  for (const stmt of SCHEMA_STATEMENTS) {
    // Mirrors ensureStorageSchema(): idempotent statements; ALTERs for
    // already-present columns throw and are intentionally ignored.
    // Match executeSchemaStatement() error filtering: only suppress
    // 'already exists' and 'duplicate column name'.
    try {
      db.exec(stmt);
    } catch (error) {
      const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (!msg.includes('already exists') && !msg.includes('duplicate column name')) {
        throw error;
      }
      /* ignore idempotent errors, same as runtime bootstrap */
    }
  }
  return {
    prepare(sql: string) {
      return new ShimStatement(db, sql);
    },
    async batch(statements: ShimStatement[]) {
      const results = [];
      try {
        db.exec('BEGIN');
        for (const s of statements) results.push(await s.run());
        db.exec('COMMIT');
        return results;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      // Note: batch is transactional like real D1; all statements commit together or all rollback
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  };
}

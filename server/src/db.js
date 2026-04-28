import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export function openDb(filename) {
  if (filename !== ':memory:') {
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
  db.exec(sql);
  // Idempotent migrations for older on-disk DBs.
  try { db.exec('ALTER TABLE members ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0'); } catch {}
  return db;
}

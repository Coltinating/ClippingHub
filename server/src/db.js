import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import bcrypt from 'bcryptjs';

const here = dirname(fileURLToPath(import.meta.url));

const BCRYPT_ROUNDS = 10;

function migrateLegacyPasswords(db) {
  // Rehash any rows that still hold plaintext passwords (legacy DBs).
  // After this runs, lobbies.password is always empty for those rows.
  const rows = db.prepare(
    "SELECT code, password FROM lobbies WHERE password != '' AND (password_hash = '' OR password_hash IS NULL)"
  ).all();
  if (!rows.length) return;
  const update = db.prepare('UPDATE lobbies SET password_hash = ?, password = \'\' WHERE code = ?');
  const tx = db.transaction((batch) => {
    for (const r of batch) {
      const hash = bcrypt.hashSync(r.password, BCRYPT_ROUNDS);
      update.run(hash, r.code);
    }
  });
  tx(rows);
}

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
  try { db.exec("ALTER TABLE lobbies ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''"); } catch {}
  migrateLegacyPasswords(db);
  return db;
}

import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db.js';

describe('openDb', () => {
  let db;
  beforeEach(() => { db = openDb(':memory:'); });
  it('creates lobbies table', () => {
    const row = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='lobbies'"
    ).get();
    expect(row?.name).toBe('lobbies');
  });
  it('roundtrips a lobby insert', () => {
    db.prepare(`INSERT INTO lobbies(code,id,name,host_id,created_at,updated_at)
                VALUES (?,?,?,?,?,?)`).run('AB12CD', 'lid', 'Test', 'u1', 1, 1);
    const got = db.prepare('SELECT name FROM lobbies WHERE code=?').get('AB12CD');
    expect(got.name).toBe('Test');
  });
});

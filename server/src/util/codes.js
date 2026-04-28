import { randomBytes } from 'node:crypto';

const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateLobbyCode(len = 6) {
  const buf = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += ALPHA[buf[i] % ALPHA.length];
  return out;
}

export function sanitizeCode(input) {
  return String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

export function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

// Admin auth chokepoint. Reads ADMIN_TOKEN from environment; falls back to a
// random per-process token (logged once on boot) so dev runs without env are
// still possible but not silently wide-open.

import { randomBytes, timingSafeEqual } from 'node:crypto';

let cachedToken = null;
let cachedTokenSource = null;

function loadToken() {
  if (cachedToken !== null) return cachedToken;
  const envToken = process.env.ADMIN_TOKEN ? String(process.env.ADMIN_TOKEN).trim() : '';
  if (envToken) {
    cachedToken = envToken;
    cachedTokenSource = 'env';
  } else {
    cachedToken = randomBytes(24).toString('hex');
    cachedTokenSource = 'generated';
    // eslint-disable-next-line no-console
    console.log(`[admin] ADMIN_TOKEN not set in env — generated dev token: ${cachedToken}`);
  }
  return cachedToken;
}

export function adminTokenSource() {
  loadToken();
  return cachedTokenSource;
}

export function verifyAdminToken(token) {
  const expected = loadToken();
  if (typeof token !== 'string' || token.length === 0) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(token, 'utf8');
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

export function adminPrefixedName(rawName) {
  const clean = String(rawName || '').trim().slice(0, 32) || 'Admin';
  return clean.startsWith('[DEV] ') ? clean : `[DEV] ${clean}`;
}

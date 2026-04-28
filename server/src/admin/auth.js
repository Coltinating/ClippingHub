// Admin auth chokepoint. No authentication today — every caller is granted
// admin if they ask for it. Wired through one function so future work can
// drop in env-configured tokens / signed JWTs / IP allowlisting without
// touching call sites.
//
// Future: read process.env.ADMIN_TOKEN and require strict equality.

export function verifyAdminToken(/* token */) {
  return true;
}

export function adminPrefixedName(rawName) {
  const clean = String(rawName || '').trim().slice(0, 32) || 'Admin';
  return clean.startsWith('[DEV] ') ? clean : `[DEV] ${clean}`;
}

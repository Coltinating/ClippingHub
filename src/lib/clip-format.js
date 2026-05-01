// Canonical timestamp/duration formatters for clip cards.
//
// Today these functions are duplicated inline in src/hub.html, src/player2.js,
// and src/post-caption.html. Drift between those copies is a known risk —
// tests/unit/clip-format.test.js pins the spec here and uses regex extraction
// to verify the inline copies still agree with this module.
//
// Production callers can be migrated to import from here incrementally; until
// then this module is the authoritative spec.

function pad2(n) {
  return String(n).padStart(2, '0');
}

// HH:MM:SS — used by clip-card IN/OUT timestamp display.
// Negative / NaN inputs clamp to 0 (matches existing hub.html behavior).
function fmtHMS(s) {
  if (!Number.isFinite(s)) s = 0;
  s = Math.floor(Math.max(0, s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return pad2(h) + ':' + pad2(m) + ':' + pad2(sec);
}

// Compact duration: "M:SS" under 1 hour, "H:MM:SS" past 1 hour.
// The 0-fallback for falsy/NaN/negative is the contract callers rely on
// (never render "NaN:NaN" on a clip card).
function fmtDur(s) {
  if (!s || !Number.isFinite(s) || s < 0) return '0:00';
  s = Math.floor(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? h + ':' + pad2(m) + ':' + pad2(sec)
    : m + ':' + pad2(sec);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { fmtHMS, fmtDur, pad2 };
}

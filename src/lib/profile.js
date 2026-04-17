(function (root, factory) {
'use strict';

var api = factory();
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.Profile = api;

})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

var X_HANDLE_RE = /^[A-Za-z0-9_]+$/;

function sanitizeXHandle(raw) {
  var v = String(raw == null ? '' : raw).trim().replace(/^@/, '');
  if (!v) return '';
  if (!X_HANDLE_RE.test(v)) return '';
  return v.slice(0, 15);
}

function resolveUserColor(profile, fallback) {
  var c = profile && profile.color;
  if (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) return c;
  return fallback || '#5bb1ff';
}

function validatePfpDataUrl(url, maxBytes) {
  if (typeof url !== 'string') return false;
  if (url.indexOf('data:image/') !== 0) return false;
  var limit = Number(maxBytes) || 0;
  if (limit > 0 && url.length > limit) return false;
  return true;
}

function buildProfilePayload(me) {
  if (!me) return { id: '', name: '', xHandle: '', color: '', pfpDataUrl: '' };
  return {
    id: String(me.id || ''),
    name: String(me.name || ''),
    xHandle: sanitizeXHandle(me.xHandle),
    color: resolveUserColor(me, ''),
    pfpDataUrl: validatePfpDataUrl(me.pfpDataUrl, 256000) ? me.pfpDataUrl : ''
  };
}

return {
  sanitizeXHandle: sanitizeXHandle,
  resolveUserColor: resolveUserColor,
  validatePfpDataUrl: validatePfpDataUrl,
  buildProfilePayload: buildProfilePayload
};

});

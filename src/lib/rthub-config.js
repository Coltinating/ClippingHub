(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RthubConfig = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var CLIENT_ID_RE = /^[A-Za-z0-9._~-]+$/;

  function mintId() {
    return 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function ensureClientId(input) {
    var s = input == null ? '' : String(input);
    if (s && CLIENT_ID_RE.test(s)) {
      return s.length <= 128 ? s : s.slice(0, 128);
    }
    return mintId();
  }

  return { ensureClientId: ensureClientId };
});

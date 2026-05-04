(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.SessionId = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Skip 0/O and 1/I/L so a code spoken or screenshotted is unambiguous.
  var ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  var LENGTH = 6;

  function mintSessionId() {
    var out = '';
    for (var i = 0; i < LENGTH; i++) {
      out += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
    }
    return out;
  }

  return { mintSessionId: mintSessionId };
});

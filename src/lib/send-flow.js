(function (root, factory) {
'use strict';

var api = factory();
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.SendFlow = api;

})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

function buildLockedClipName(helperName, rawName) {
  var helper = String(helperName == null ? '' : helperName).trim();
  var name = String(rawName == null ? '' : rawName).trim();
  if (!helper) return name;
  var prefix = helper + ' - ';
  if (name.indexOf(prefix) === 0) return name;
  return prefix + name;
}

function stripLockedPrefix(rawName, helperName) {
  var helper = String(helperName == null ? '' : helperName).trim();
  var name = String(rawName == null ? '' : rawName);
  if (!helper) return name;
  var prefix = helper + ' - ';
  if (name.indexOf(prefix) === 0) return name.slice(prefix.length);
  return name;
}

var TRACKED_FIELDS = ['inTime', 'outTime', 'postCaption', 'name', 'caption'];

function shouldResend(range, patch) {
  if (!range || !range.sentBy) return false;
  if (!patch || typeof patch !== 'object') return false;
  for (var i = 0; i < TRACKED_FIELDS.length; i++) {
    if (patch[TRACKED_FIELDS[i]] !== undefined) return true;
  }
  return false;
}

return {
  buildLockedClipName: buildLockedClipName,
  stripLockedPrefix: stripLockedPrefix,
  shouldResend: shouldResend
};

});

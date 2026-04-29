(function (root, factory) {
'use strict';

var api = factory();
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.RolePermissions = api;

})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

var VALID = { viewer: 1, clipper: 1, helper: 1 };

function normalizeRole(raw) {
  var v = String(raw == null ? '' : raw).toLowerCase();
  if (v === 'host') return 'clipper';
  if (v === 'editor') return 'viewer';
  return VALID[v] ? v : 'viewer';
}

function getDefaultJoinRole() { return 'viewer'; }

function isClipperRole(role) { return normalizeRole(role) === 'clipper'; }
function isHelperRole(role) { return normalizeRole(role) === 'helper'; }
function isViewerRole(role) { return normalizeRole(role) === 'viewer'; }

function canAssignRole(actor, target, newRole) {
  if (!actor || !target) return false;
  if (!VALID[String(newRole).toLowerCase()]) return false;
  return isClipperRole(actor.role);
}

function canMarkClips(role) {
  var r = normalizeRole(role);
  return r === 'clipper' || r === 'helper';
}
function canSendDelivery(role) { return normalizeRole(role) === 'helper'; }
function canConsumeDeliveries(role) { return normalizeRole(role) === 'clipper'; }
function canAssistClipper(role) {
  var r = normalizeRole(role);
  return r === 'viewer' || r === 'helper';
}

return {
  normalizeRole: normalizeRole,
  getDefaultJoinRole: getDefaultJoinRole,
  isClipperRole: isClipperRole,
  isHelperRole: isHelperRole,
  isViewerRole: isViewerRole,
  canAssignRole: canAssignRole,
  canMarkClips: canMarkClips,
  canSendDelivery: canSendDelivery,
  canConsumeDeliveries: canConsumeDeliveries,
  canAssistClipper: canAssistClipper
};

});

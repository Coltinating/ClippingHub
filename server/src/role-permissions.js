const VALID = { viewer: 1, clipper: 1, helper: 1 };

export function normalizeRole(raw) {
  const v = String(raw == null ? '' : raw).toLowerCase();
  if (v === 'host') return 'clipper';
  if (v === 'editor') return 'viewer';
  return VALID[v] ? v : 'viewer';
}

export function getDefaultJoinRole() { return 'viewer'; }

export function isClipperRole(role) { return normalizeRole(role) === 'clipper'; }
export function isHelperRole(role) { return normalizeRole(role) === 'helper'; }
export function isViewerRole(role) { return normalizeRole(role) === 'viewer'; }

export function canAssignRole(actor, target, newRole) {
  if (!actor || !target) return false;
  if (!VALID[String(newRole).toLowerCase()]) return false;
  return isClipperRole(actor.role);
}

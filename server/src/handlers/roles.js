import { canAssignRole } from '../role-permissions.js';

export function setRole({ ws, msg, send, broadcast, presence, store, logger }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });
  const actor = store.getMember(ent.code, ent.userId);
  const target = store.getMember(ent.code, msg.memberId);
  if (!actor || !target) return send(ws, { type: 'error', code: 'not_found', message: 'member missing' });
  if (!canAssignRole(actor, target, msg.role)) {
    logger?.warn?.({ evt: 'handler:set-role:rejected', code: ent.code, actor: ent.userId, target: msg.memberId, role: msg.role });
    return send(ws, { type: 'error', code: 'forbidden', message: 'cannot assign role' });
  }
  const { updatedMember, affectedHelpers } = store.setMemberRole(ent.code, msg.memberId, msg.role);
  logger?.info?.({ evt: 'handler:set-role', code: ent.code, target: msg.memberId, role: msg.role, by: ent.userId, cascade: affectedHelpers.length });
  if (updatedMember) broadcast(ent.code, { type: 'member:updated', member: updatedMember });
  for (const m of affectedHelpers) broadcast(ent.code, { type: 'member:updated', member: m });
}

export function setAssist({ ws, msg, send, broadcast, presence, store, logger }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });

  // Validate assistUserId
  if (msg.assistUserId !== null) {
    if (msg.assistUserId === ent.userId) {
      return send(ws, { type: 'error', code: 'invalid_assist_target', message: 'cannot assist yourself' });
    }
    const target = store.getMember(ent.code, msg.assistUserId);
    if (!target || target.role !== 'clipper') {
      return send(ws, { type: 'error', code: 'invalid_assist_target', message: 'target must be an active clipper' });
    }
  }

  const updated = store.setMemberAssist(ent.code, ent.userId, msg.assistUserId, msg.role);
  logger?.info?.({ evt: 'handler:set-assist', code: ent.code, userId: ent.userId, assistUserId: msg.assistUserId, role: msg.role });
  if (updated) broadcast(ent.code, { type: 'member:updated', member: updated });
}

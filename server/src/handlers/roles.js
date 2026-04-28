import { canAssignRole } from '../role-permissions.js';

export function setRole({ ws, msg, send, broadcast, presence, store }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });
  const actor = store.getMember(ent.code, ent.userId);
  const target = store.getMember(ent.code, msg.memberId);
  if (!actor || !target) return send(ws, { type: 'error', code: 'not_found', message: 'member missing' });
  if (!canAssignRole(actor, target, msg.role)) {
    return send(ws, { type: 'error', code: 'forbidden', message: 'cannot assign role' });
  }
  const updated = store.setMemberRole(ent.code, msg.memberId, msg.role);
  if (updated) broadcast(ent.code, { type: 'member:updated', member: updated });
}

export function setAssist({ ws, msg, send, broadcast, presence, store }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });
  const updated = store.setMemberAssist(ent.code, ent.userId, msg.assistUserId);
  if (updated) broadcast(ent.code, { type: 'member:updated', member: updated });
}

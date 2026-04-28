export function upsertRange({ ws, msg, send, broadcast, presence, store, logger }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });
  const range = store.upsertRange(ent.code, msg.range);
  logger?.info?.({ evt: 'handler:clip:upsert-range', code: ent.code, userId: ent.userId, rangeId: range?.id });
  broadcast(ent.code, { type: 'clip:range-upserted', range });
}

export function removeRange({ ws, msg, send, broadcast, presence, store, logger }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });
  store.removeRange(ent.code, msg.id);
  logger?.info?.({ evt: 'handler:clip:remove-range', code: ent.code, userId: ent.userId, rangeId: msg.id });
  broadcast(ent.code, { type: 'clip:range-removed', id: msg.id });
}

function _peerByUserId(presence, code, userId) {
  for (const peer of presence.membersOf(code)) {
    const w = presence.who(peer);
    if (w && w.userId === userId) return peer;
  }
  return null;
}

export function deliveryCreate({ ws, msg, send, presence, store, logger }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });

  const senderMember = store.getMember(ent.code, ent.userId);
  const senderRole = senderMember?.role || '';
  if (senderRole !== 'helper' && senderRole !== 'clipper') {
    logger?.warn?.({ evt: 'delivery:rejected', reason: 'sender_role', code: ent.code, userId: ent.userId, role: senderRole });
    return send(ws, { type: 'error', code: 'forbidden_role', message: 'only helper or clipper can send clips' });
  }

  const d = msg.delivery || {};
  if (!d.toUserId) return send(ws, { type: 'error', code: 'bad_delivery', message: 'toUserId required' });
  const targetMember = store.getMember(ent.code, d.toUserId);
  if (!targetMember) {
    logger?.warn?.({ evt: 'delivery:rejected', reason: 'no_target', code: ent.code, toUserId: d.toUserId });
    return send(ws, { type: 'error', code: 'no_target', message: 'target user not in lobby' });
  }
  // Force fromUserId to the authenticated sender so a client cannot spoof.
  d.fromUserId = ent.userId;

  const delivery = store.createDelivery(ent.code, d);
  logger?.info?.({ evt: 'handler:clip:delivery-create', code: ent.code, fromUserId: ent.userId, toUserId: d.toUserId, deliveryId: delivery?.id, type: d.type });

  // Targeted send: sender (echo) + target only, not the whole lobby.
  send(ws, { type: 'clip:delivery', delivery });
  const targetWs = _peerByUserId(presence, ent.code, d.toUserId);
  if (targetWs && targetWs !== ws) send(targetWs, { type: 'clip:delivery', delivery });
}

export function deliveryConsume({ ws, msg, send, presence, store, logger }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });
  store.markDelivered(msg.ids);
  logger?.info?.({ evt: 'handler:clip:delivery-consume', code: ent.code, userId: ent.userId, ids: (msg.ids || []).length });
}

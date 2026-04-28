export function upsertRange({ ws, msg, send, broadcast, presence, store }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });
  const range = store.upsertRange(ent.code, msg.range);
  broadcast(ent.code, { type: 'clip:range-upserted', range });
}

export function removeRange({ ws, msg, send, broadcast, presence, store }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });
  store.removeRange(ent.code, msg.id);
  broadcast(ent.code, { type: 'clip:range-removed', id: msg.id });
}

export function deliveryCreate({ ws, msg, send, broadcast, presence, store }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });
  const delivery = store.createDelivery(ent.code, msg.delivery);
  broadcast(ent.code, { type: 'clip:delivery', delivery });
}

export function deliveryConsume({ ws, msg, send, presence, store }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });
  store.markDelivered(msg.ids);
}

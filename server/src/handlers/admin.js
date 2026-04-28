import { adminPrefixedName } from '../admin/auth.js';
import { getEventRing, subscribeEvents } from '../log.js';

function ensureAdmin(presence, ws, send) {
  const ent = presence.who(ws);
  if (!ent || !ent.isAdmin) {
    send(ws, { type: 'error', code: 'forbidden', message: 'admin only' });
    return null;
  }
  return ent;
}

// Active admin event subscriptions: ws → unsubscribe function.
const eventSubs = new WeakMap();

export function listLobbies({ ws, send, presence, store, logger }) {
  if (!ensureAdmin(presence, ws, send)) return;
  const lobbies = store.listAllLobbies();
  logger?.info?.({ evt: 'handler:admin:list-lobbies', count: lobbies.length });
  send(ws, { type: 'admin:lobbies', lobbies });
}

export function sendChat({ ws, msg, send, broadcast, presence, store, logger }) {
  const ent = ensureAdmin(presence, ws, send);
  if (!ent) return;
  const lobby = store.getLobby(msg.code);
  if (!lobby) return send(ws, { type: 'error', code: 'not_found', message: 'lobby not found' });
  const text = msg.text.trim();
  if (!text) return;
  const adminName = adminPrefixedName(ent.userName);
  const chatMsg = store.addChat({
    code: msg.code,
    userId: ent.userId,
    userName: adminName,
    text
  });
  logger?.info?.({ evt: 'handler:admin:send-chat', code: msg.code, by: ent.userId });
  broadcast(msg.code, { type: 'chat:message', message: chatMsg });
  send(ws, { type: 'admin:ack', action: 'send-chat', code: msg.code });
}

export function subscribeEventsHandler({ ws, send, presence, logger }) {
  if (!ensureAdmin(presence, ws, send)) return;
  // If already subscribed, do nothing — idempotent.
  if (eventSubs.has(ws)) return send(ws, { type: 'admin:ack', action: 'subscribe-events' });

  // Replay the in-memory ring as a single batch so the operator sees recent
  // history immediately.
  const ring = getEventRing();
  if (ring.length) send(ws, { type: 'admin:event-batch', events: ring });

  const unsub = subscribeEvents((event) => {
    if (ws.readyState === 1) send(ws, { type: 'admin:event', event });
  });
  eventSubs.set(ws, unsub);
  logger?.info?.({ evt: 'handler:admin:subscribe-events', replayed: ring.length });
  send(ws, { type: 'admin:ack', action: 'subscribe-events' });
}

export function unsubscribeEventsHandler({ ws, send, presence }) {
  if (!ensureAdmin(presence, ws, send)) return;
  const unsub = eventSubs.get(ws);
  if (unsub) { try { unsub(); } catch (_) {} eventSubs.delete(ws); }
  send(ws, { type: 'admin:ack', action: 'unsubscribe-events' });
}

// Called from router onClose to clean up subscriptions.
export function detachAdminSubscription(ws) {
  const unsub = eventSubs.get(ws);
  if (unsub) { try { unsub(); } catch (_) {} eventSubs.delete(ws); }
}

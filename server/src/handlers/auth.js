import { verifyAdminToken, adminPrefixedName } from '../admin/auth.js';

export function hello({ ws, msg, send, presence, logger }) {
  let user = msg.user;
  let isAdmin = false;
  const authTried = !!(msg.admin && msg.admin.token);
  if (msg.admin && verifyAdminToken(msg.admin.token)) {
    isAdmin = true;
    user = { ...user, name: adminPrefixedName(msg.admin.name) };
  }
  presence.attach(ws, user);
  const ent = presence.who(ws);
  if (ent) ent.isAdmin = isAdmin;
  logger?.info?.({ evt: 'handler:hello', userId: user?.id, name: user?.name, isAdmin, authTried });
  send(ws, { type: 'hello:ack', serverVersion: '0.1.0', isAdmin, authTried });
}

function sendPendingDeliveries({ ws, send, store, code, userId }) {
  try {
    const pending = store.pendingDeliveriesFor(code, userId) || [];
    if (pending.length) send(ws, { type: 'clip:delivery-pending', deliveries: pending });
  } catch (_) { /* ignore */ }
}

export function lobbyCreate({ ws, msg, send, presence, store, logger }) {
  const who = presence.who(ws);
  if (!who) return send(ws, { type: 'error', code: 'no_session', message: 'hello first' });
  const lobby = store.createLobby({
    name: msg.name,
    password: msg.password,
    user: { id: who.userId, name: who.userName, ...(who.user || {}) },
    code: msg.code,
    isAdmin: !!who.isAdmin
  });
  presence.bind(ws, lobby.code);
  logger?.info?.({ evt: 'handler:lobby:create', code: lobby.code, hostId: who.userId });
  send(ws, { type: 'lobby:state', lobby });
  sendPendingDeliveries({ ws, send, store, code: lobby.code, userId: who.userId });
}

export function lobbyJoin({ ws, msg, send, broadcast, presence, store, logger }) {
  const who = presence.who(ws);
  if (!who) return send(ws, { type: 'error', code: 'no_session', message: 'hello first' });
  const lobby = store.joinLobby({
    code: msg.code,
    password: msg.password,
    user: { id: who.userId, name: who.userName, ...(who.user || {}) },
    isAdmin: !!who.isAdmin
  });
  presence.bind(ws, lobby.code);
  logger?.info?.({ evt: 'handler:lobby:join', code: lobby.code, userId: who.userId, members: lobby.members.length });
  send(ws, { type: 'lobby:state', lobby });
  sendPendingDeliveries({ ws, send, store, code: lobby.code, userId: who.userId });
  const me = lobby.members.find(m => m.id === who.userId);
  if (me) broadcast(lobby.code, { type: 'member:joined', member: me }, ws);
}

export function profileUpdate({ ws, msg, send, broadcast, presence, store, logger }) {
  const who = presence.who(ws);
  if (!who) return send(ws, { type: 'error', code: 'no_session', message: 'hello first' });
  const user = msg.user || {};
  const cleaned = {
    id: who.userId, // immutable
    name: typeof user.name === 'string' ? user.name.slice(0, 64) : (who.userName || ''),
    xHandle: typeof user.xHandle === 'string' ? user.xHandle.slice(0, 32) : '',
    color: typeof user.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(user.color) ? user.color : '',
    pfpDataUrl: typeof user.pfpDataUrl === 'string' && user.pfpDataUrl.length < 300000 ? user.pfpDataUrl : ''
  };
  presence.update(ws, cleaned);
  if (who.code) {
    const updated = store.updateMemberProfile(who.code, who.userId, cleaned);
    if (updated) broadcast(who.code, { type: 'member:updated', member: updated });
  }
  send(ws, { type: 'profile:update-ack' });
  logger?.info?.({ evt: 'handler:profile:update', userId: who.userId, name: cleaned.name });
}

export function lobbyLeave({ ws, broadcast, presence, store, logger }) {
  const who = presence.who(ws);
  const code = presence.unbind(ws);
  if (code && who) {
    logger?.info?.({ evt: 'handler:lobby:leave', code, userId: who.userId });
    let affectedHelpers = [];
    try {
      const result = store.leaveLobby(code, who.userId);
      affectedHelpers = result.affectedHelpers || [];
    } catch {}
    broadcast(code, { type: 'member:left', memberId: who.userId });
    for (const m of affectedHelpers) broadcast(code, { type: 'member:updated', member: m });
  }
}

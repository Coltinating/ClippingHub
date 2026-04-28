import { adminPrefixedName } from '../admin/auth.js';

function ensureAdmin(presence, ws, send) {
  const ent = presence.who(ws);
  if (!ent || !ent.isAdmin) {
    send(ws, { type: 'error', code: 'forbidden', message: 'admin only' });
    return null;
  }
  return ent;
}

export function listLobbies({ ws, send, presence, store }) {
  if (!ensureAdmin(presence, ws, send)) return;
  const lobbies = store.listAllLobbies();
  send(ws, { type: 'admin:lobbies', lobbies });
}

export function sendChat({ ws, msg, send, broadcast, presence, store }) {
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
  broadcast(msg.code, { type: 'chat:message', message: chatMsg });
  send(ws, { type: 'admin:ack', action: 'send-chat', code: msg.code });
}

export function chatSend({ ws, msg, send, broadcast, presence, store, logger }) {
  const ent = presence.who(ws);
  if (!ent?.code) return send(ws, { type: 'error', code: 'no_lobby', message: 'join first' });
  const text = msg.text.trim();
  if (!text) return;
  const m = store.addChat({ code: ent.code, userId: ent.userId, userName: ent.userName, text });
  logger?.info?.({ evt: 'handler:chat:send', code: ent.code, userId: ent.userId, len: text.length });
  broadcast(ent.code, { type: 'chat:message', message: m });
}

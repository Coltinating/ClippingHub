export function hello({ ws, msg, send, presence }) {
  presence.attach(ws, msg.user);
  send(ws, { type: 'hello:ack', serverVersion: '0.1.0' });
}

export function lobbyCreate({ ws, msg, send, presence, store }) {
  const who = presence.who(ws);
  if (!who) return send(ws, { type: 'error', code: 'no_session', message: 'hello first' });
  const lobby = store.createLobby({
    name: msg.name,
    password: msg.password,
    user: { id: who.userId, name: who.userName, ...(who.user || {}) },
    code: msg.code
  });
  presence.bind(ws, lobby.code);
  send(ws, { type: 'lobby:state', lobby });
}

export function lobbyJoin({ ws, msg, send, broadcast, presence, store }) {
  const who = presence.who(ws);
  if (!who) return send(ws, { type: 'error', code: 'no_session', message: 'hello first' });
  const lobby = store.joinLobby({
    code: msg.code,
    password: msg.password,
    user: { id: who.userId, name: who.userName, ...(who.user || {}) }
  });
  presence.bind(ws, lobby.code);
  send(ws, { type: 'lobby:state', lobby });
  const me = lobby.members.find(m => m.id === who.userId);
  if (me) broadcast(lobby.code, { type: 'member:joined', member: me }, ws);
}

export function lobbyLeave({ ws, broadcast, presence, store }) {
  const who = presence.who(ws);
  const code = presence.unbind(ws);
  if (code && who) {
    try { store.leaveLobby(code, who.userId); } catch {}
    broadcast(code, { type: 'member:left', memberId: who.userId });
  }
}

import { Inbound, Outbound } from './protocol.js';

export function makeRouter({ store, presence, handlers, logger }) {
  function send(ws, msg) {
    const valid = Outbound.safeParse(msg);
    if (!valid.success) {
      logger?.error?.({ msg, err: valid.error.message }, 'invalid outbound');
      return;
    }
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }
  function broadcast(code, msg, except = null) {
    for (const peer of presence.membersOf(code)) {
      if (peer !== except) send(peer, msg);
    }
  }
  function onMessage(ws, raw) {
    let parsed;
    try { parsed = Inbound.parse(JSON.parse(raw.toString())); }
    catch (e) {
      send(ws, { type: 'error', code: 'bad_request', message: e.message });
      return;
    }
    const handler = handlers[parsed.type];
    if (!handler) {
      send(ws, { type: 'error', code: 'no_handler', message: parsed.type });
      return;
    }
    try { handler({ ws, msg: parsed, send, broadcast, presence, store, logger }); }
    catch (e) {
      logger?.warn?.({ err: e.message, type: parsed.type }, 'handler error');
      send(ws, { type: 'error', code: 'handler_error', message: e.message });
    }
  }
  function onClose(ws) {
    const who = presence.who(ws);
    const code = presence.detach(ws);
    if (code && who) {
      try { store.leaveLobby(code, who.userId); } catch {}
      broadcast(code, { type: 'member:left', memberId: who.userId });
    }
  }
  return { onMessage, onClose, send, broadcast };
}

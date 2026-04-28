import { Inbound, Outbound } from './protocol.js';

// Outbound types whose firehose would drown the admin event log without
// adding signal — we still send them, just don't record per-message events.
const OUTBOUND_LOG_SKIP = new Set(['admin:event', 'admin:event-batch', 'pong', 'transcript:chunk']);
// Inbound types that fire frequently for housekeeping.
const INBOUND_LOG_SKIP = new Set(['ping', 'admin:list-lobbies']);

export function makeRouter({ store, presence, handlers, logger }) {
  function send(ws, msg) {
    const valid = Outbound.safeParse(msg);
    if (!valid.success) {
      logger?.error?.({ evt: 'ws:invalid-outbound', type: msg && msg.type, err: valid.error.message });
      return;
    }
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(msg));
      if (!OUTBOUND_LOG_SKIP.has(msg.type)) {
        const who = presence.who(ws);
        logger?.info?.({ evt: 'ws:out', type: msg.type, code: who?.code, userId: who?.userId });
      }
    }
  }
  function broadcast(code, msg, except = null) {
    let n = 0;
    for (const peer of presence.membersOf(code)) {
      if (peer !== except && peer.readyState === 1) {
        const valid = Outbound.safeParse(msg);
        if (!valid.success) {
          logger?.error?.({ evt: 'ws:invalid-broadcast', type: msg && msg.type, err: valid.error.message });
          return;
        }
        peer.send(JSON.stringify(msg));
        n++;
      }
    }
    if (!OUTBOUND_LOG_SKIP.has(msg.type)) {
      logger?.info?.({ evt: 'ws:broadcast', type: msg.type, code, recipients: n });
    }
  }
  function onMessage(ws, raw) {
    let parsed;
    try { parsed = Inbound.parse(JSON.parse(raw.toString())); }
    catch (e) {
      logger?.warn?.({ evt: 'ws:bad-inbound', err: e.message });
      send(ws, { type: 'error', code: 'bad_request', message: e.message });
      return;
    }
    if (!INBOUND_LOG_SKIP.has(parsed.type)) {
      const who = presence.who(ws);
      logger?.info?.({ evt: 'ws:in', type: parsed.type, code: who?.code, userId: who?.userId });
    }
    const handler = handlers[parsed.type];
    if (!handler) {
      send(ws, { type: 'error', code: 'no_handler', message: parsed.type });
      return;
    }
    try { handler({ ws, msg: parsed, send, broadcast, presence, store, logger }); }
    catch (e) {
      logger?.warn?.({ evt: 'handler:error', type: parsed.type, err: e.message });
      send(ws, { type: 'error', code: 'handler_error', message: e.message });
    }
  }
  function onClose(ws) {
    const who = presence.who(ws);
    const code = presence.detach(ws);
    if (code && who) {
      logger?.info?.({ evt: 'ws:close', code, userId: who.userId });
      try { store.leaveLobby(code, who.userId); } catch {}
      broadcast(code, { type: 'member:left', memberId: who.userId });
    }
  }
  return { onMessage, onClose, send, broadcast };
}

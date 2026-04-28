const RECONNECT_MS = 2000;

export class CollabClient {
  constructor({ url, user, wsCtor = (u) => new WebSocket(u) }) {
    this.url = url;
    this.user = user;
    this.wsCtor = wsCtor;
    this.ws = null;
    this.connected = false;
    this.connecting = null;
    this.listeners = new Map();
    this.pending = [];
    this._stopped = false;
  }

  on(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  off(type, fn) { this.listeners.get(type)?.delete(fn); }
  _emit(type, payload) {
    const set = this.listeners.get(type);
    if (set) for (const fn of set) fn(payload);
  }

  connect() {
    if (this.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise((resolve, reject) => {
      const ws = this.wsCtor(this.url);
      this.ws = ws;
      ws.onopen = () => { this._send({ type: 'hello', user: this.user }); };
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (msg.type === 'hello:ack' && !this.connected) {
          this.connected = true;
          this.connecting = null;
          resolve();
        }
        this._dispatch(msg);
      };
      ws.onerror = (e) => { if (!this.connected) reject(e); };
      ws.onclose = () => {
        const wasConnected = this.connected;
        this.connected = false;
        this.connecting = null;
        this._emit('disconnected', {});
        if (!this._stopped && wasConnected) {
          setTimeout(() => this.connect().catch(() => {}), RECONNECT_MS);
        }
      };
    });
    return this.connecting;
  }

  disconnect() {
    this._stopped = true;
    try { this.ws?.close(); } catch {}
  }

  _send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }

  _dispatch(msg) {
    for (let i = 0; i < this.pending.length; i++) {
      const p = this.pending[i];
      if (p.matchType === msg.type || (msg.type === 'error' && p.matchType !== 'error')) {
        clearTimeout(p.timeoutId);
        this.pending.splice(i, 1);
        if (msg.type === 'error') p.reject(new Error(msg.message));
        else p.resolve(msg);
        break;
      }
    }
    this._emit(msg.type, msg);
  }

  _request(outbound, matchType, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      this.pending.push({
        resolve: (m) => resolve(m.lobby ?? m),
        reject,
        matchType,
        timeoutId
      });
      this._send(outbound);
    });
  }

  createLobby({ name, password = '', code }) {
    return this._request({ type: 'lobby:create', name, password, code }, 'lobby:state');
  }
  joinLobby({ code, password = '' }) {
    return this._request({ type: 'lobby:join', code, password }, 'lobby:state');
  }
  leaveLobby() { this._send({ type: 'lobby:leave' }); }
  sendChat(text) { this._send({ type: 'chat:send', text }); }
  setRole(memberId, role) { this._send({ type: 'member:set-role', memberId, role }); }
  setAssist(assistUserId) { this._send({ type: 'member:set-assist', assistUserId }); }
  upsertRange(range) { this._send({ type: 'clip:upsert-range', range }); }
  removeRange(id) { this._send({ type: 'clip:remove-range', id }); }
  createDelivery(delivery) { this._send({ type: 'clip:delivery-create', delivery }); }
  consumeDeliveries(ids) { this._send({ type: 'clip:delivery-consume', ids }); }
  startTranscript({ channelId, videoUrl }) { this._send({ type: 'transcript:start', channelId, videoUrl }); }
  stopTranscript() { this._send({ type: 'transcript:stop' }); }
}

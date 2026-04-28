(function (root, factory) {
'use strict';
var api = factory();
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.CollabClient = api.CollabClient;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

var RECONNECT_MS = 2000;

function CollabClient(opts) {
  if (!opts) opts = {};
  this.url = opts.url;
  this.user = opts.user;
  this.wsCtor = opts.wsCtor || function (u) { return new WebSocket(u); };
  this.ws = null;
  this.connected = false;
  this.connecting = null;
  this.listeners = new Map();
  this.pending = [];
  this._stopped = false;
}

CollabClient.prototype.on = function (type, fn) {
  if (!this.listeners.has(type)) this.listeners.set(type, new Set());
  this.listeners.get(type).add(fn);
};
CollabClient.prototype.off = function (type, fn) {
  var set = this.listeners.get(type);
  if (set) set.delete(fn);
};
CollabClient.prototype._emit = function (type, payload) {
  var set = this.listeners.get(type);
  if (!set) return;
  set.forEach(function (fn) { fn(payload); });
};

CollabClient.prototype.connect = function () {
  var self = this;
  if (this.connected) return Promise.resolve();
  if (this.connecting) return this.connecting;
  this.connecting = new Promise(function (resolve, reject) {
    var ws = self.wsCtor(self.url);
    self.ws = ws;
    ws.onopen = function () { self._send({ type: 'hello', user: self.user }); };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg.type === 'hello:ack' && !self.connected) {
        self.connected = true;
        self.connecting = null;
        resolve();
      }
      self._dispatch(msg);
    };
    ws.onerror = function (e) { if (!self.connected) reject(e); };
    ws.onclose = function () {
      var wasConnected = self.connected;
      self.connected = false;
      self.connecting = null;
      self._emit('disconnected', {});
      if (!self._stopped && wasConnected) {
        setTimeout(function () { self.connect().catch(function () {}); }, RECONNECT_MS);
      }
    };
  });
  return this.connecting;
};

CollabClient.prototype.disconnect = function () {
  this._stopped = true;
  try { if (this.ws) this.ws.close(); } catch (_) {}
};

CollabClient.prototype._send = function (msg) {
  if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
};

CollabClient.prototype._dispatch = function (msg) {
  for (var i = 0; i < this.pending.length; i++) {
    var p = this.pending[i];
    if (p.matchType === msg.type || (msg.type === 'error' && p.matchType !== 'error')) {
      clearTimeout(p.timeoutId);
      this.pending.splice(i, 1);
      if (msg.type === 'error') p.reject(new Error(msg.message));
      else p.resolve(msg);
      break;
    }
  }
  this._emit(msg.type, msg);
};

CollabClient.prototype._request = function (outbound, matchType, timeoutMs) {
  var self = this;
  if (!timeoutMs) timeoutMs = 5000;
  return new Promise(function (resolve, reject) {
    var timeoutId = setTimeout(function () { reject(new Error('timeout')); }, timeoutMs);
    self.pending.push({
      resolve: function (m) { resolve(m && m.lobby !== undefined ? m.lobby : m); },
      reject: reject,
      matchType: matchType,
      timeoutId: timeoutId
    });
    self._send(outbound);
  });
};

CollabClient.prototype.createLobby = function (opts) {
  return this._request({ type: 'lobby:create', name: opts.name, password: opts.password || '', code: opts.code }, 'lobby:state');
};
CollabClient.prototype.joinLobby = function (opts) {
  return this._request({ type: 'lobby:join', code: opts.code, password: opts.password || '' }, 'lobby:state');
};
CollabClient.prototype.leaveLobby = function () { this._send({ type: 'lobby:leave' }); };
CollabClient.prototype.sendChat = function (text) { this._send({ type: 'chat:send', text: text }); };
CollabClient.prototype.setRole = function (memberId, role) { this._send({ type: 'member:set-role', memberId: memberId, role: role }); };
CollabClient.prototype.setAssist = function (assistUserId) { this._send({ type: 'member:set-assist', assistUserId: assistUserId }); };
CollabClient.prototype.upsertRange = function (range) { this._send({ type: 'clip:upsert-range', range: range }); };
CollabClient.prototype.removeRange = function (id) { this._send({ type: 'clip:remove-range', id: id }); };
CollabClient.prototype.createDelivery = function (delivery) { this._send({ type: 'clip:delivery-create', delivery: delivery }); };
CollabClient.prototype.consumeDeliveries = function (ids) { this._send({ type: 'clip:delivery-consume', ids: ids }); };
CollabClient.prototype.startTranscript = function (opts) { this._send({ type: 'transcript:start', channelId: opts.channelId, videoUrl: opts.videoUrl }); };
CollabClient.prototype.stopTranscript = function () { this._send({ type: 'transcript:stop' }); };

return { CollabClient: CollabClient };

});

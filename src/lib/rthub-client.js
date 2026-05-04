(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RthubClient = api.RthubClient;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var P = (typeof require === 'function')
    ? require('./rthub-protocol.js')
    : (typeof globalThis !== 'undefined' ? globalThis.RthubProtocol : null);
  var S = (typeof require === 'function')
    ? require('./rthub-state.js').RthubState
    : (typeof globalThis !== 'undefined' ? globalThis.RthubState : null);

  var BACKOFF_BASE_MS = 500;
  var BACKOFF_MAX_MS = 30000;

  function RthubClient(opts) {
    if (!opts) opts = {};
    this.urlBase = opts.url || '';
    this.sessionId = opts.sessionId || '';
    this.clientId = opts.clientId || '';
    this.profile = opts.profile || {};
    this.wsCtor = opts.wsCtor || function (u) { return new WebSocket(u); };
    this.ws = null;
    this.connected = false;
    this.connecting = null;
    this.listeners = new Map();
    this._stopped = false;
    this._backoffMs = BACKOFF_BASE_MS;
    this._seenDeliveryKeys = new Set();
    this._state = new S({ sessionId: this.sessionId, myClientId: this.clientId });
  }

  RthubClient.prototype.on = function (t, fn) {
    if (!this.listeners.has(t)) this.listeners.set(t, new Set());
    this.listeners.get(t).add(fn);
  };
  RthubClient.prototype.off = function (t, fn) {
    var s = this.listeners.get(t); if (s) s.delete(fn);
  };
  RthubClient.prototype._emit = function (t, m) {
    var s = this.listeners.get(t); if (!s) return;
    s.forEach(function (fn) { try { fn(m); } catch (_) {} });
  };

  RthubClient.prototype._connectUrl = function () {
    var sep = this.urlBase.indexOf('?') >= 0 ? '&' : '?';
    return this.urlBase
      + '/' + encodeURIComponent(this.sessionId)
      + sep + 'clientId=' + encodeURIComponent(this.clientId);
  };

  RthubClient.prototype.connect = function () {
    var self = this;
    if (this.connected) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this._stopped = false;
    this.connecting = new Promise(function (resolve, reject) {
      var ws = self.wsCtor(self._connectUrl());
      self.ws = ws;
      ws.onopen = function () {
        self._send(Object.assign({ type: 'peerProfile' }, self.profile));
      };
      ws.onmessage = function (ev) {
        var msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }
        if (msg && msg.type === 'stateSnapshot' && !self.connected) {
          self.connected = true;
          self.connecting = null;
          self._backoffMs = BACKOFF_BASE_MS;
          self._handleSnapshot(msg);
          resolve();
          return;
        }
        self._dispatch(msg);
      };
      ws.onerror = function (e) { if (!self.connected) reject(e); };
      ws.onclose = function () {
        self.connected = false;
        self.connecting = null;
        self._state.reset();
        self._emit('disconnected', { type: 'disconnected' });
        if (self._stopped) return;
        var jittered = self._backoffMs + Math.random() * self._backoffMs;
        self._backoffMs = Math.min(self._backoffMs * 2, BACKOFF_MAX_MS);
        setTimeout(function () {
          if (self._stopped) return;
          self.connect().catch(function () {});
        }, jittered);
      };
    });
    return this.connecting;
  };

  RthubClient.prototype._reconnectNow = function () {
    if (this._stopped) return;
    this.connecting = null;
    this.connect().catch(function () {});
  };

  RthubClient.prototype.disconnect = function () {
    this._stopped = true;
    try { if (this.ws) this.ws.close(); } catch (_) {}
  };

  RthubClient.prototype.getLobby = function () {
    return this._state ? this._state.snapshot() : null;
  };

  RthubClient.prototype._send = function (m) {
    if (!this.ws || this.ws.readyState !== 1) return;
    var clean = P.sanitizeOutbound ? P.sanitizeOutbound(m) : m;
    if (!clean) return;
    this.ws.send(JSON.stringify(clean));
  };

  RthubClient.prototype._handleSnapshot = function (msg) {
    this._state.apply(msg);
    this._emit('lobby:state', { type: 'lobby:state', lobby: this._state.snapshot() });
    // Replay optional sync fields so late joiners catch up to current playhead/playback/etc.
    if (msg.timeline)  this._emit('timeline:update',  msg.timeline);
    if (msg.clipRange) this._emit('cliprange:update', msg.clipRange);
    if (msg.playback)  this._emit('playback:update',  msg.playback);
    if (msg.selection) this._emit('selection:update', msg.selection);
  };

  RthubClient.prototype._peerLookup = function (clientId) {
    var lobby = this._state.snapshot();
    if (!lobby) return null;
    var found = null;
    for (var i = 0; i < lobby.members.length; i++) {
      if (lobby.members[i].id === clientId) { found = lobby.members[i]; break; }
    }
    return found;
  };

  RthubClient.prototype._dispatch = function (msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'presenceUpdate': {
        var lobby = this._state.snapshot();
        var existed = !!(lobby && lobby.members.find(function (m) { return m.id === msg.clientId; }));
        this._state.apply(msg);
        if (msg.action === 'join') {
          this._emit('member:joined', { type: 'member:joined', member: P.presenceToMember(msg) });
          if (existed) {
            this._emit('member:updated', { type: 'member:updated', member: P.presenceToMember(msg) });
          }
        } else if (msg.action === 'leave') {
          this._emit('member:left', { type: 'member:left', memberId: msg.clientId });
        }
        return;
      }
      case 'chatMessage': {
        this._state.apply(msg);
        this._emit('chat:message', { type: 'chat:message', message: P.chatToLegacy(msg) });
        return;
      }
      case 'clipRangeUpsert': {
        this._state.apply(msg);
        this._emit('clip:range-upserted',
                   { type: 'clip:range-upserted', range: P.upsertToRange(msg) });
        return;
      }
      case 'clipRangeRemove': {
        this._state.apply(msg);
        this._emit('clip:range-removed', { type: 'clip:range-removed', id: msg.id });
        return;
      }
      case 'delivery': {
        var key = (msg.rangeId || '') + '|' + (msg.sourceClientId || '') + '|' + (msg.ts || 0);
        if (this._seenDeliveryKeys.has(key)) return;
        this._seenDeliveryKeys.add(key);
        var legacy = P.deliveryToLegacy(msg, this._peerLookup.bind(this));
        this._emit('clip:delivery', { type: 'clip:delivery', delivery: legacy });
        return;
      }
      case 'timelineUpdate':  this._emit('timeline:update', msg);  return;
      case 'clipRangeUpdate': this._emit('cliprange:update', msg); return;
      case 'playbackUpdate':  this._emit('playback:update', msg);  return;
      case 'selectionUpdate': this._emit('selection:update', msg); return;
      case 'cursorUpdate':    this._emit('cursor:update', msg);    return;
      case 'errorEvent':
        this._emit('error', { type: 'error', code: msg.code, message: msg.message, details: msg.details });
        return;
    }
  };

  RthubClient.prototype.sendChat = function (text) {
    var id = 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    this._send({
      type: 'chatMessage', id: id, body: text,
      author: this.profile.name || '', userId: this.clientId
    });
  };
  RthubClient.prototype.upsertRange = function (range) {
    this._send(P.rangeToUpsert(range));
  };
  RthubClient.prototype.removeRange = function (id) {
    this._send({ type: 'clipRangeRemove', id: id });
  };
  RthubClient.prototype.createDelivery = function (delivery) {
    this._send({
      type: 'delivery',
      toClientId: delivery.toUserId,
      kind: delivery.type,
      rangeId: delivery.rangeId,
      payload: delivery.payload || {}
    });
  };
  RthubClient.prototype.consumeDeliveries = function () {
    // No-op: rthub auto-drains on reconnect; legacy callers safely keep calling this.
  };
  RthubClient.prototype.updateProfile = function (profile) {
    this.profile = Object.assign({}, this.profile, profile || {});
    if (this.connected) this._send(Object.assign({ type: 'peerProfile' }, this.profile));
  };

  RthubClient.prototype.sendTimeline = function (positionMs) {
    this._send({ type: 'timelineUpdate', positionMs: positionMs | 0 });
  };
  RthubClient.prototype.sendClipRange = function (inMs, outMs) {
    this._send({ type: 'clipRangeUpdate', inMs: inMs | 0, outMs: outMs | 0 });
  };
  RthubClient.prototype.sendPlayback = function (state, positionMs, rate) {
    this._send({ type: 'playbackUpdate', state: state, positionMs: positionMs | 0, rate: rate || 1 });
  };
  RthubClient.prototype.sendSelection = function (clipIds) {
    this._send({ type: 'selectionUpdate', clipIds: clipIds || [] });
  };
  RthubClient.prototype.sendCursor = function (positionMs) {
    this._send({ type: 'cursorUpdate', positionMs: positionMs | 0 });
  };

  // Legacy create/join/leave become session swaps for callers that still invoke them.
  RthubClient.prototype.createLobby = function (opts) {
    var self = this;
    this.sessionId = String((opts && (opts.code || opts.name)) || this.sessionId);
    this._state = new S({ sessionId: this.sessionId, myClientId: this.clientId });
    return this.connect().then(function () { return self._state.snapshot(); });
  };
  RthubClient.prototype.joinLobby = function (opts) {
    var self = this;
    this.sessionId = String((opts && opts.code) || this.sessionId);
    this._state = new S({ sessionId: this.sessionId, myClientId: this.clientId });
    return this.connect().then(function () { return self._state.snapshot(); });
  };
  RthubClient.prototype.leaveLobby = function () { this.disconnect(); };
  RthubClient.prototype.setRole = function () { /* deferred — rthub spec has no server-authoritative role */ };
  RthubClient.prototype.setAssist = function (assistUserId) {
    this.updateProfile({ assistUserId: assistUserId || null });
  };

  return { RthubClient: RthubClient };
});

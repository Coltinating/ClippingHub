(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RthubState = api.RthubState;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var P = (typeof require === 'function')
    ? require('./rthub-protocol.js')
    : (typeof globalThis !== 'undefined' ? globalThis.RthubProtocol : null);

  function RthubState(opts) {
    this.sessionId = (opts && opts.sessionId) || '';
    this.myClientId = (opts && opts.myClientId) || '';
    this.lobby = null;
  }

  RthubState.prototype.snapshot = function () { return this.lobby; };

  RthubState.prototype.reset = function () { this.lobby = null; };

  RthubState.prototype._ensureLobby = function () {
    if (!this.lobby) {
      this.lobby = {
        code: this.sessionId,
        name: 'Session ' + this.sessionId,
        members: [], chat: [], clipRanges: [], deliveries: []
      };
    }
    return this.lobby;
  };

  RthubState.prototype.apply = function (msg) {
    if (!msg || !msg.type) return;
    switch (msg.type) {
      case 'stateSnapshot': {
        this.lobby = {
          code: this.sessionId,
          name: 'Session ' + this.sessionId,
          members: (msg.presence || []).map(P.presenceToMember).filter(Boolean),
          chat: (msg.chat || []).map(P.chatToLegacy).filter(Boolean),
          clipRanges: (msg.clipRanges || []).map(P.upsertToRange),
          deliveries: []
        };
        return;
      }
      case 'presenceUpdate': {
        var lobby = this._ensureLobby();
        if (msg.action === 'leave') {
          lobby.members = lobby.members.filter(function (m) { return m.id !== msg.clientId; });
          return;
        }
        // join + heartbeat: merge profile fields. join fires BEFORE peerProfile
        // so it often carries no profile; a follow-up heartbeat carries it.
        // Replacing instead of merging blanks role/name on every late frame.
        var i = lobby.members.findIndex(function (m) { return m.id === msg.clientId; });
        var patch = P.presenceToProfilePatch(msg);
        if (i < 0) {
          lobby.members.push(Object.assign(P.presenceToMember(msg), patch));
        } else {
          lobby.members[i] = Object.assign({}, lobby.members[i], patch);
        }
        return;
      }
      case 'chatMessage': {
        var lobby2 = this._ensureLobby();
        var msgId = msg && msg.id;
        if (msgId && lobby2.chat.some(function (c) { return c.id === msgId; })) return;
        lobby2.chat.push(P.chatToLegacy(msg));
        return;
      }
      case 'clipRangeUpsert': {
        var lobby3 = this._ensureLobby();
        var ix = lobby3.clipRanges.findIndex(function (r) { return r.id === msg.id; });
        var rec = P.upsertToRange(msg);
        if (ix >= 0) lobby3.clipRanges[ix] = rec;
        else lobby3.clipRanges.push(rec);
        return;
      }
      case 'clipRangeRemove': {
        var lobby4 = this._ensureLobby();
        lobby4.clipRanges = lobby4.clipRanges.filter(function (r) { return r.id !== msg.id; });
        return;
      }
    }
  };

  return { RthubState: RthubState };
});

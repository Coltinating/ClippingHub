(function (root, factory) {
'use strict';
var api = factory();
if (typeof module !== 'undefined' && module.exports) module.exports = api;
if (root) root.CollabStore = api.CollabStore;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
'use strict';

function CollabStore() {
  this.state = null;
  this.subs = new Set();
}

CollabStore.prototype.subscribe = function (fn) {
  var self = this;
  this.subs.add(fn);
  return function () { self.subs.delete(fn); };
};
CollabStore.prototype._emit = function () {
  var state = this.state;
  this.subs.forEach(function (fn) { fn(state); });
};

CollabStore.prototype.apply = function (msg) {
  switch (msg.type) {
    case 'lobby:state':
      this.state = msg.lobby;
      break;
    case 'lobby:closed':
      this.state = null;
      break;
    case 'member:joined':
      if (this.state && !this.state.members.find(function (m) { return m.id === msg.member.id; })) {
        this.state.members.push(msg.member);
      }
      break;
    case 'member:left':
      if (this.state) {
        this.state.members = this.state.members.filter(function (m) { return m.id !== msg.memberId; });
      }
      break;
    case 'member:updated':
      if (this.state) {
        var i = this.state.members.findIndex(function (m) { return m.id === msg.member.id; });
        if (i >= 0) this.state.members[i] = msg.member;
      }
      break;
    case 'chat:message':
      if (this.state) this.state.chat.push(msg.message);
      break;
    case 'clip:range-upserted':
      if (this.state) {
        var ix = this.state.clipRanges.findIndex(function (r) { return r.id === msg.range.id; });
        if (ix >= 0) this.state.clipRanges[ix] = msg.range;
        else this.state.clipRanges.push(msg.range);
      }
      break;
    case 'clip:range-removed':
      if (this.state) {
        this.state.clipRanges = this.state.clipRanges.filter(function (r) { return r.id !== msg.id; });
      }
      break;
  }
  this._emit();
};

return { CollabStore: CollabStore };

});

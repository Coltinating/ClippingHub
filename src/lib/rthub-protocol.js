(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RthubProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Fields the rthub clipRangeUpsert schema accepts (per spec server/rthub-workers-docs.md).
  var UPSERT_FIELDS = [
    'id', 'inTime', 'outTime', 'status', 'pendingOut', 'streamKey',
    'name', 'caption', 'postCaption', 'fileName',
    'clipperId', 'clipperName', 'helperId', 'helperName',
    'userId', 'userName'
  ];

  function rangeToUpsert(range) {
    var out = { type: 'clipRangeUpsert' };
    if (!range || typeof range !== 'object') return out;
    for (var i = 0; i < UPSERT_FIELDS.length; i++) {
      var k = UPSERT_FIELDS[i];
      if (range[k] !== undefined && range[k] !== null) out[k] = range[k];
    }
    return out;
  }

  function upsertToRange(msg) {
    var out = {};
    if (!msg) return out;
    for (var i = 0; i < UPSERT_FIELDS.length; i++) {
      var k = UPSERT_FIELDS[i];
      if (msg[k] !== undefined) out[k] = msg[k];
    }
    return out;
  }

  function presenceToMember(p) {
    if (!p) return null;
    return {
      id: p.clientId,
      name: p.name || '',
      role: p.role || 'viewer',
      joinedAt: p.ts || 0,
      lastSeenAt: p.ts || 0,
      xHandle: p.xHandle || null,
      color: p.color || null,
      pfpDataUrl: null,
      assistUserId: p.assistUserId || null
    };
  }

  function chatToLegacy(m) {
    if (!m) return null;
    return {
      id: m.id,
      text: m.body || '',
      userId: m.userId || m.sourceClientId || '',
      userName: m.author || '',
      createdAt: m.ts || 0
    };
  }

  function deliveryToLegacy(m, peerLookup) {
    if (!m) return null;
    var sender = (typeof peerLookup === 'function' ? peerLookup(m.sourceClientId) : null) || {};
    var syntheticId = 'd_' + (m.rangeId || '') + '_' + (m.sourceClientId || '') + '_' + (m.ts || 0);
    return {
      id: syntheticId,
      type: m.kind,
      toUserId: m.toClientId,
      fromUserId: m.sourceClientId || '',
      fromUserName: sender.name || '',
      fromUserColor: sender.color || '',
      rangeId: m.rangeId,
      payload: m.payload || {}
    };
  }

  return {
    rangeToUpsert: rangeToUpsert,
    upsertToRange: upsertToRange,
    presenceToMember: presenceToMember,
    chatToLegacy: chatToLegacy,
    deliveryToLegacy: deliveryToLegacy
  };
});

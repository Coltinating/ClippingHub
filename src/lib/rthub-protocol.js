(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.RthubProtocol = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Fields the rthub clipRangeUpsert schema accepts (per AsyncAPI spec).
  var UPSERT_FIELDS = [
    'id', 'inTime', 'outTime', 'status', 'pendingOut', 'streamKey',
    'name', 'caption', 'postCaption', 'fileName',
    'clipperId', 'clipperName', 'helperId', 'helperName',
    'userId', 'userName'
  ];

  // Spec constants from https://rthub.1626.workers.dev/asyncapi.yaml
  var COLOR_RE = /^#[0-9a-fA-F]{6}$/;
  var ROLES = { clipper: 1, helper: 1, viewer: 1 };
  var STATUSES = { marking: 1, queued: 1, downloading: 1, done: 1, error: 1 };
  var KINDS = { clip: 1, clipUpdate: 1, clipUnsend: 1 };
  var STATES = { playing: 1, paused: 1 };
  // maxLength caps from the spec
  var CAPS = {
    name: 80, xHandle: 64, assistUserId: 128,
    id: 128, body: 2000, author: 80, userId: 128, streamKey: 128,
    caption: 2000, postCaption: 2000, fileName: 256,
    clipperId: 128, clipperName: 80, helperId: 128, helperName: 80, userName: 80,
    toClientId: 128, rangeId: 128, message: 2000
  };

  function isNonNegInt(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v === (v | 0); }
  function nonEmptyStr(v, max) {
    if (typeof v !== 'string' || !v) return null;
    return v.length > max ? v.slice(0, max) : v;
  }
  function optStr(v, max) {
    if (v == null || v === '') return undefined;
    if (typeof v !== 'string') return undefined;
    return v.length > max ? v.slice(0, max) : v;
  }
  function optNonNegInt(v) { return isNonNegInt(v) ? v : undefined; }
  function optBool(v) { return typeof v === 'boolean' ? v : undefined; }
  function optEnum(v, set) { return (typeof v === 'string' && set[v]) ? v : undefined; }
  function optColor(v) { return (typeof v === 'string' && COLOR_RE.test(v)) ? v : undefined; }

  function setIfDefined(out, key, val) { if (val !== undefined) out[key] = val; }

  function sanitizeOutbound(msg) {
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return null;
    switch (msg.type) {
      case 'timelineUpdate': {
        if (!isNonNegInt(msg.positionMs)) return null;
        return { type: 'timelineUpdate', positionMs: msg.positionMs };
      }
      case 'clipRangeUpdate': {
        if (!isNonNegInt(msg.inMs) || !isNonNegInt(msg.outMs)) return null;
        return { type: 'clipRangeUpdate', inMs: msg.inMs, outMs: msg.outMs };
      }
      case 'playbackUpdate': {
        var state = optEnum(msg.state, STATES);
        if (!state) return null;
        if (!isNonNegInt(msg.positionMs)) return null;
        var out = { type: 'playbackUpdate', state: state, positionMs: msg.positionMs };
        if (typeof msg.rate === 'number' && Number.isFinite(msg.rate) && msg.rate >= 0) out.rate = msg.rate;
        return out;
      }
      case 'chatMessage': {
        var id = nonEmptyStr(msg.id, CAPS.id);
        var body = nonEmptyStr(msg.body, CAPS.body);
        if (!id || !body) return null;
        var c = { type: 'chatMessage', id: id, body: body };
        setIfDefined(c, 'author', optStr(msg.author, CAPS.author));
        setIfDefined(c, 'userId', optStr(msg.userId, CAPS.userId));
        return c;
      }
      case 'selectionUpdate': {
        if (!Array.isArray(msg.clipIds)) return null;
        var ids = [];
        for (var i = 0; i < msg.clipIds.length && ids.length < 1024; i++) {
          var s = nonEmptyStr(msg.clipIds[i], 128);
          if (s) ids.push(s);
        }
        return { type: 'selectionUpdate', clipIds: ids };
      }
      case 'cursorUpdate': {
        if (!isNonNegInt(msg.positionMs)) return null;
        return { type: 'cursorUpdate', positionMs: msg.positionMs };
      }
      case 'clipRangeUpsert': {
        var rid = nonEmptyStr(msg.id, CAPS.id);
        if (!rid) return null;
        var u = { type: 'clipRangeUpsert', id: rid };
        setIfDefined(u, 'inTime', optNonNegInt(msg.inTime));
        setIfDefined(u, 'outTime', optNonNegInt(msg.outTime));
        setIfDefined(u, 'status', optEnum(msg.status, STATUSES));
        setIfDefined(u, 'pendingOut', optBool(msg.pendingOut));
        setIfDefined(u, 'streamKey', optStr(msg.streamKey, CAPS.streamKey));
        setIfDefined(u, 'name', optStr(msg.name, CAPS.name));
        setIfDefined(u, 'caption', optStr(msg.caption, CAPS.caption));
        setIfDefined(u, 'postCaption', optStr(msg.postCaption, CAPS.postCaption));
        setIfDefined(u, 'fileName', optStr(msg.fileName, CAPS.fileName));
        setIfDefined(u, 'clipperId', optStr(msg.clipperId, CAPS.clipperId));
        setIfDefined(u, 'clipperName', optStr(msg.clipperName, CAPS.clipperName));
        setIfDefined(u, 'helperId', optStr(msg.helperId, CAPS.helperId));
        setIfDefined(u, 'helperName', optStr(msg.helperName, CAPS.helperName));
        setIfDefined(u, 'userId', optStr(msg.userId, CAPS.userId));
        setIfDefined(u, 'userName', optStr(msg.userName, CAPS.userName));
        return u;
      }
      case 'clipRangeRemove': {
        var rrid = nonEmptyStr(msg.id, CAPS.id);
        if (!rrid) return null;
        return { type: 'clipRangeRemove', id: rrid };
      }
      case 'delivery': {
        var to = nonEmptyStr(msg.toClientId, CAPS.toClientId);
        var kind = optEnum(msg.kind, KINDS);
        var range = nonEmptyStr(msg.rangeId, CAPS.rangeId);
        if (!to || !kind || !range) return null;
        var d = { type: 'delivery', toClientId: to, kind: kind, rangeId: range };
        if (msg.payload !== undefined) d.payload = msg.payload;
        return d;
      }
      case 'peerProfile': {
        var p = { type: 'peerProfile' };
        setIfDefined(p, 'name', optStr(msg.name, CAPS.name));
        setIfDefined(p, 'color', optColor(msg.color));
        setIfDefined(p, 'role', optEnum(msg.role, ROLES));
        setIfDefined(p, 'xHandle', optStr(msg.xHandle, CAPS.xHandle));
        setIfDefined(p, 'assistUserId', optStr(msg.assistUserId, CAPS.assistUserId));
        return p;
      }
      default:
        // Unknown type — pass through for forward compat.
        return msg;
    }
  }

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
    deliveryToLegacy: deliveryToLegacy,
    sanitizeOutbound: sanitizeOutbound
  };
});

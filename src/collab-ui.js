(function () {
'use strict';

var STORAGE_KEY = 'ch_collab_ui_v3';
var listeners = [];
var statusText = '';

var NAME_COLORS = [
  '#5bb1ff', '#ff7a59', '#33d69f', '#ffcf5a', '#f08fff',
  '#7ee3ff', '#ff9e7d', '#7be08b', '#ffd16e', '#c8a0ff'
];
var utils = window.CollabUtils || null;

var client = null;
var store = null;
var connStage = 'offline'; // offline | connecting | no-lobby | in-lobby

// Inbound deliveries addressed to me. Pushed on `clip:delivery` WS event,
// drained by consumeMyDeliveries() (called from renderer.js).
var _inboundDeliveries = [];
var _seenDeliveryIds = new Set();

function dlog(cat, msg, data) {
  try { if (window.dbg) window.dbg(cat, msg, data); } catch (_) {}
}

function loggedServerGetConfig() {
  dlog('GET', 'serverGetConfig');
  return window.clipper.serverGetConfig();
}
function loggedServerSetConfig(cfg) {
  dlog('SET', 'serverSetConfig', cfg);
  return window.clipper.serverSetConfig(cfg);
}

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function safeCode(raw) {
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
}

function normalizeName(raw) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 32);
}

function normalizeRole(raw) {
  var role = String(raw || '').toLowerCase();
  return role === 'helper' ? 'helper' : 'clipper';
}

function alpha(hex, a) {
  var clean = String(hex || '').replace('#', '');
  if (clean.length !== 6) return 'rgba(255,255,255,' + a + ')';
  var r = parseInt(clean.slice(0, 2), 16);
  var g = parseInt(clean.slice(2, 4), 16);
  var b = parseInt(clean.slice(4, 6), 16);
  return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
}

function hashString(v) {
  var s = String(v || '');
  var h = 0;
  for (var i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function loadPrefsLegacy() {
  // localStorage is keyed by origin; the loopback proxy uses an ephemeral port,
  // so prefs survive Ctrl+R but NOT a full app restart. Kept as a one-shot
  // migration source until the disk-config IPC hydrates.
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (_) {
    return {};
  }
}

var prefs = loadPrefsLegacy();
var state = {
  me: {
    id: (window.RthubConfig && window.RthubConfig.ensureClientId)
      ? window.RthubConfig.ensureClientId(prefs.meId || '')
      : makeId('u'),
    name: normalizeName(prefs.meName || 'You'),
    xHandle: (window.Profile && window.Profile.sanitizeXHandle(prefs.meXHandle)) || '',
    color: (window.Profile && window.Profile.resolveUserColor({ color: prefs.meColor }, '')) || '',
    pfpDataUrl: (window.Profile && window.Profile.validatePfpDataUrl(prefs.mePfpDataUrl, 256000) ? prefs.mePfpDataUrl : '') || '',
    role: prefs.meRole || 'clipper',
    assistUserId: prefs.meAssistUserId || ''
  },
  lobby: null,
  members: [],
  chat: [],
  clipRanges: [],
  lastCode: safeCode(prefs.lastCode || '')
};

var _saveTimer = null;
var _saveDirty = false;

function savePrefs() {
  // Debounced disk write via IPC. Pulled out of render hot path; only called
  // from updateLocalProfile and lobby create/leave paths.
  _saveDirty = true;
  if (_saveTimer) return;
  _saveTimer = setTimeout(function () {
    _saveTimer = null;
    if (!_saveDirty) return;
    _saveDirty = false;
    var payload = {
      name: state.me.name,
      xHandle: state.me.xHandle || '',
      color: state.me.color || '',
      pfpDataUrl: state.me.pfpDataUrl || '',
      lastCode: state.lobby ? state.lobby.code : state.lastCode,
      meId: state.me.id,
      meRole: state.me.role || 'clipper',
      meAssistUserId: state.me.assistUserId || ''
    };
    if (window.clipper && window.clipper.profileSetConfig) {
      try { window.clipper.profileSetConfig(payload); } catch (_) {}
    }
    // Mirror to localStorage as defense in depth for browser/dev contexts.
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        meName: payload.name,
        meXHandle: payload.xHandle,
        meColor: payload.color,
        mePfpDataUrl: payload.pfpDataUrl,
        lastCode: payload.lastCode,
        meId: payload.meId,
        meRole: payload.meRole,
        meAssistUserId: payload.meAssistUserId
      }));
    } catch (_) {}
  }, 250);
}

// Async hydrate from disk config. Disk wins over localStorage (it's
// authoritative across launches, since localStorage is keyed by ephemeral port).
if (window.clipper && window.clipper.profileGetConfig) {
  try {
    window.clipper.profileGetConfig().then(function (cfg) {
      if (!cfg || typeof cfg !== 'object') return;
      var changed = false;
      if (cfg.meId && window.RthubConfig && window.RthubConfig.ensureClientId) {
        var diskId = window.RthubConfig.ensureClientId(cfg.meId);
        if (diskId && diskId !== state.me.id) {
          state.me.id = diskId; changed = true;
        }
      }
      if (cfg.name && cfg.name !== state.me.name) {
        state.me.name = normalizeName(cfg.name); changed = true;
      }
      if (cfg.xHandle && cfg.xHandle !== state.me.xHandle && window.Profile) {
        state.me.xHandle = window.Profile.sanitizeXHandle(cfg.xHandle); changed = true;
      }
      if (cfg.color && cfg.color !== state.me.color && window.Profile) {
        state.me.color = window.Profile.resolveUserColor({ color: cfg.color }, ''); changed = true;
      }
      if (cfg.pfpDataUrl && cfg.pfpDataUrl !== state.me.pfpDataUrl && window.Profile) {
        if (window.Profile.validatePfpDataUrl(cfg.pfpDataUrl, 256000)) {
          state.me.pfpDataUrl = cfg.pfpDataUrl; changed = true;
        }
      }
      if (cfg.lastCode && safeCode(cfg.lastCode) !== state.lastCode) {
        state.lastCode = safeCode(cfg.lastCode); changed = true;
      }
      if (cfg.meRole && cfg.meRole !== state.me.role) {
        state.me.role = String(cfg.meRole); changed = true;
      }
      if (cfg.meAssistUserId != null && cfg.meAssistUserId !== state.me.assistUserId) {
        state.me.assistUserId = String(cfg.meAssistUserId || ''); changed = true;
      }
      if (changed && typeof emit === 'function') emit();
    }).catch(function () {});
  } catch (_) {}
}

function updateLocalProfile(partial) {
  if (!partial || typeof partial !== 'object') return;
  if (partial.name != null) state.me.name = normalizeName(partial.name);
  if (partial.xHandle != null && window.Profile) {
    state.me.xHandle = window.Profile.sanitizeXHandle(partial.xHandle);
  }
  if (partial.color != null && window.Profile) {
    state.me.color = window.Profile.resolveUserColor({ color: partial.color }, '');
  }
  if (partial.pfpDataUrl != null && window.Profile) {
    state.me.pfpDataUrl = window.Profile.validatePfpDataUrl(partial.pfpDataUrl, 256000) ? partial.pfpDataUrl : '';
  }
  if (partial.role != null) state.me.role = String(partial.role) || 'clipper';
  if (partial.assistUserId !== undefined) state.me.assistUserId = String(partial.assistUserId || '');
  savePrefs();
  try {
    if (client && client.updateProfile) {
      client.updateProfile(peerProfilePayload());
    }
  } catch (_) {}
  emit();
}

function findMemberById(memberId) {
  if (!memberId) return null;
  for (var i = 0; i < state.members.length; i++) {
    if (state.members[i].id === memberId) return state.members[i];
  }
  return null;
}

function myMember() {
  return state.members.find(function (m) { return m.id === state.me.id; }) || null;
}

function myRole() {
  // In lobby: peerProfile broadcast is the source of truth. Else local choice.
  var fromMember = myMember() && myMember().role;
  if (fromMember) return fromMember;
  return state.me.role || 'viewer';
}

function canMarkClipsLocal() {
  // Outside a lobby, default to clipper (solo clipping is allowed).
  if (!state.lobby) return true;
  return !!(window.RolePermissions && window.RolePermissions.canMarkClips(myRole()));
}
function canSendDeliveryLocal() {
  if (!state.lobby) return false;
  return !!(window.RolePermissions && window.RolePermissions.canSendDelivery(myRole()));
}
function canConsumeDeliveriesLocal() {
  if (!state.lobby) return false;
  return !!(window.RolePermissions && window.RolePermissions.canConsumeDeliveries(myRole()));
}

function myAssistUserId() {
  return (myMember() && myMember().assistUserId) || null;
}

function groupMembers(members) {
  var clipperById = new Map();
  var orphanHelpers = [];
  var viewers = [];
  for (var i = 0; i < members.length; i++) {
    var m = members[i];
    if (m.role === 'clipper') clipperById.set(m.id, Object.assign({}, m, { helpers: [] }));
    else if (m.role === 'viewer') viewers.push(m);
  }
  for (var i = 0; i < members.length; i++) {
    var m = members[i];
    if (m.role !== 'helper') continue;
    var target = clipperById.get(m.assistUserId);
    if (target) target.helpers.push(m);
    else orphanHelpers.push(m);
  }
  return { clippers: Array.from(clipperById.values()), orphanHelpers: orphanHelpers, viewers: viewers };
}

function getMarkContext() {
  var meName = normalizeName(state.me.name || 'You') || 'You';
  var meId = state.me.id;
  if (myRole() !== 'helper') {
    return {
      userId: meId, userName: meName,
      clipperId: meId, clipperName: meName,
      helperId: null, helperName: ''
    };
  }
  var assist = findMemberById(myAssistUserId());
  if (!assist) {
    return {
      userId: meId, userName: meName,
      clipperId: meId, clipperName: meName,
      helperId: null, helperName: ''
    };
  }
  var clipperName = normalizeName(assist.name || '') || 'Clipper';
  return {
    userId: meId, userName: meName,
    clipperId: assist.id, clipperName: clipperName,
    helperId: meId, helperName: meName
  };
}

function getMemberColorMap() {
  var list = state.members.slice().sort(function (a, b) {
    var aj = a.joinedAt || 0;
    var bj = b.joinedAt || 0;
    if (aj < bj) return -1;
    if (aj > bj) return 1;
    var ai = a.id || '';
    var bi = b.id || '';
    return ai < bi ? -1 : ai > bi ? 1 : 0;
  });

  var map = {};
  for (var i = 0; i < list.length; i++) {
    map[list[i].id] = NAME_COLORS[i % NAME_COLORS.length];
  }
  if (!map[state.me.id]) {
    map[state.me.id] = NAME_COLORS[hashString(state.me.id) % NAME_COLORS.length];
  }
  return map;
}

function getUserColor(userId, userName) {
  var map = getMemberColorMap();
  if (userId && map[userId]) return map[userId];
  return NAME_COLORS[hashString(userName || userId || 'x') % NAME_COLORS.length];
}

var _emitScheduled = false;
function _emitNow() {
  _emitScheduled = false;
  dlog('COLLAB:STATE', 'emit', {
    role: myRole(),
    assistUserId: myAssistUserId() || '',
    lobby: state.lobby ? state.lobby.code : null,
    members: state.members.length,
    inboundDeliveries: _inboundDeliveries.length
  });
  renderAll();
  for (var i = 0; i < listeners.length; i++) listeners[i](state);
}
function emit() {
  // Coalesce multiple state changes in the same frame into one render.
  if (_emitScheduled) return;
  _emitScheduled = true;
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(_emitNow);
  else setTimeout(_emitNow, 0);
}

function setStatus(msg) {
  statusText = msg || '';
  renderStatus();
}

function setStage(next) {
  connStage = next;
  var off = document.getElementById('collabStageOffline');
  var inLob = document.getElementById('collabStageInLobby');
  if (off) off.hidden = (next !== 'offline');
  if (inLob) inLob.hidden = (next !== 'in-lobby');
  var pill = document.getElementById('collabConnStatus');
  if (pill) {
    if (next === 'offline') {
      pill.dataset.state = 'offline';
      pill.textContent = '● Offline';
    } else if (next === 'connecting') {
      pill.dataset.state = 'connecting';
      pill.textContent = '● Connecting…';
    } else {
      pill.dataset.state = 'online';
      pill.textContent = '● Online';
    }
  }
}

function applyLobbySnapshot(lobby) {
  if (!lobby) {
    state.lobby = null;
    state.members = [];
    state.chat = [];
    state.clipRanges = [];
    bumpRangesVersion();
    setStage(client && client.connected ? 'no-lobby' : 'offline');
    savePrefs();
    emit();
    return;
  }
  state.lobby = {
    id: lobby.id || null,
    code: safeCode(lobby.code || ''),
    name: String(lobby.name || 'Collab Lobby'),
    hostId: lobby.hostId || null,
    createdAt: lobby.createdAt || nowIso()
  };
  state.lastCode = state.lobby.code;
  state.members = Array.isArray(lobby.members) ? lobby.members.slice() : [];
  state.chat = Array.isArray(lobby.chat) ? lobby.chat.slice() : [];
  state.clipRanges = Array.isArray(lobby.clipRanges) ? lobby.clipRanges.slice() : [];
  bumpRangesVersion();
  setStage('in-lobby');
  savePrefs();
  emit();
}

function attachClientHandlers() {
  if (!client || !store) return;
  client.on('lobby:state', function (m) { store.apply(m); applyLobbySnapshot(store.state); });
  client.on('lobby:closed', function (m) { store.apply(m); applyLobbySnapshot(null); });
  client.on('member:joined', function (m) { store.apply(m); applyLobbySnapshot(store.state); });
  client.on('member:left',   function (m) { store.apply(m); applyLobbySnapshot(store.state); });
  client.on('member:updated', function (m) { store.apply(m); applyLobbySnapshot(store.state); });
  client.on('chat:message',  function (m) { store.apply(m); applyLobbySnapshot(store.state); });
  client.on('clip:range-upserted', function (m) { store.apply(m); applyLobbySnapshot(store.state); });
  client.on('clip:range-removed',  function (m) { store.apply(m); applyLobbySnapshot(store.state); });
  client.on('clip:delivery', function (m) {
    var d = m && m.delivery;
    if (!d || !d.id) { dlog('COLLAB:RECV', 'clip:delivery (malformed)', m); return; }
    dlog('COLLAB:RECV', 'clip:delivery', { id: d.id, type: d.type, toUserId: d.toUserId, fromUserId: d.fromUserId, rangeId: d.rangeId });
    // Only consume deliveries addressed to me (server may broadcast to whole lobby).
    if (d.toUserId && d.toUserId !== state.me.id) return;
    if (_seenDeliveryIds.has(d.id)) return;
    _seenDeliveryIds.add(d.id);
    _inboundDeliveries.push(d);
    if (window._panelBus && window._panelBus.emit) {
      window._panelBus.emit('collab:delivery', d);
    }
    emit();
  });
  client.on('clip:delivery-pending', function (m) {
    var list = (m && Array.isArray(m.deliveries)) ? m.deliveries : [];
    dlog('COLLAB:RECV', 'clip:delivery-pending (backfill)', { count: list.length });
    var added = 0;
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (!d || !d.id) continue;
      if (d.toUserId && d.toUserId !== state.me.id) continue;
      if (_seenDeliveryIds.has(d.id)) continue;
      _seenDeliveryIds.add(d.id);
      _inboundDeliveries.push(d);
      added++;
    }
    if (added) emit();
  });
  client.on('disconnected', function () {
    dlog('COLLAB:RECV', 'disconnected');
    _inboundDeliveries.length = 0;
    _seenDeliveryIds.clear();
    setStage('offline');
    state.lobby = null;
    emit();
  });
  // Realtime sync surfaces re-broadcast on the panel bus so renderer/timeline
  // modules can subscribe without a hard dependency on the client implementation.
  if (window._panelBus && window._panelBus.emit && client.on) {
    var bus = window._panelBus;
    var SYNC_EVENTS = [
      ['timeline:update',  'rthub:timeline'],
      ['playback:update',  'rthub:playback'],
      ['selection:update', 'rthub:selection'],
      ['cursor:update',    'rthub:cursor'],
      ['cliprange:update', 'rthub:cliprange']
    ];
    SYNC_EVENTS.forEach(function (pair) {
      try { client.on(pair[0], function (m) { bus.emit(pair[1], m); }); } catch (_) {}
    });
  }
}

function peerProfilePayload() {
  // Spec defines peerProfile merge: empty fields overwrite. Only include
  // keys with real values so reconnects don't clobber prior broker state.
  var raw = {
    name: state.me.name,
    color: state.me.color,
    role: state.me.role,
    xHandle: state.me.xHandle,
    assistUserId: state.me.assistUserId
  };
  var out = {};
  for (var k in raw) if (raw[k] != null && raw[k] !== '') out[k] = raw[k];
  return out;
}

function makeRthubStoreProxy(rthubClient) {
  // RthubClient applies events to its internal state before emitting; the
  // proxy lets the existing handlers keep their `store.apply(m); apply(store.state)`
  // shape without code changes downstream.
  return {
    apply: function () { /* no-op; rthub maintains state internally */ },
    get state() { return rthubClient.getLobby(); }
  };
}

async function connect(url, opts) {
  var clean = String(url || '').trim();
  if (!clean) { setStatus('Enter a server URL'); return; }
  if (!window.RthubClient) { setStatus('Rthub client not loaded'); return; }

  var serverCfg = null;
  if (window.clipper && window.clipper.serverSetConfig) {
    try {
      serverCfg = (window.clipper.serverGetConfig ? await loggedServerGetConfig() : {}) || {};
      serverCfg.url = clean;
      if (opts && opts.autoConnect != null) serverCfg.autoConnect = !!opts.autoConnect;
      if (opts && opts.sessionId) serverCfg.sessionId = String(opts.sessionId);
      await loggedServerSetConfig(serverCfg);
    } catch (_) {}
  }

  var sessionId = (opts && opts.sessionId) || (serverCfg && serverCfg.sessionId) || state.lastCode || '';
  if (!sessionId) { setStage('offline'); setStatus('Pick a session ID first'); return; }

  setStage('connecting');
  setStatus('');
  if (client) { try { client.disconnect(); } catch (_) {} }

  state.lastCode = safeCode(sessionId);
  client = new window.RthubClient({
    url: clean,
    sessionId: sessionId,
    clientId: state.me.id,
    profile: peerProfilePayload()
  });
  store = makeRthubStoreProxy(client);
  attachClientHandlers();
  try {
    await client.connect();
    setStage('in-lobby');
  } catch (e) {
    setStage('offline');
    setStatus('Could not connect: ' + (e && e.message ? e.message : 'error'));
  }
}

function disconnect() {
  dlog('ACTION', 'collab disconnect');
  if (client) { try { client.disconnect(); } catch (_) {} }
  client = null;
  store = null;
  state.lobby = null;
  state.members = [];
  state.chat = [];
  state.clipRanges = [];
  bumpRangesVersion();
  _inboundDeliveries.length = 0;
  _seenDeliveryIds.clear();
  setStage('offline');
  emit();
}

async function leaveLobby() {
  if (!state.lobby || !client) return;
  dlog('ACTION', 'leaveLobby', { code: state.lobby.code });
  try { client.leaveLobby(); } catch (_) {}
  _inboundDeliveries.length = 0;
  _seenDeliveryIds.clear();
  applyLobbySnapshot(null);
  setStatus('No active lobby');
}

async function refreshLobby() {
  return state.lobby; // server pushes; nothing to fetch
}

function updateMeName(name) {
  var clean = normalizeName(name);
  if (!clean) return false;
  state.me.name = clean;
  savePrefs();
  return true;
}

async function addChat(text, userName) {
  var msg = String(text || '').trim();
  if (!msg || !state.lobby || !client) return null;
  if (!updateMeName(userName || state.me.name)) return null;
  dlog('ACTION', 'sendChat', { len: msg.length });
  client.sendChat(msg);
  return null;
}

function upsertClipRange(range) {
  if (!range || !isFinite(range.inTime)) return null;
  var inTime = Number(range.inTime);
  var outCandidate = Number(range.outTime);
  var outTime = isFinite(outCandidate) ? outCandidate : inTime;
  var rangeId = range.id || makeId('range');
  var existing = null;
  for (var i = 0; i < state.clipRanges.length; i++) {
    if (state.clipRanges[i].id === rangeId) {
      existing = state.clipRanges[i];
      break;
    }
  }
  var actor = getMarkContext();
  var next = {
    id: rangeId,
    userId: range.userId || actor.userId || state.me.id,
    userName: range.userName || actor.userName || state.me.name,
    clipperId: range.clipperId || (existing && existing.clipperId) || actor.clipperId || state.me.id,
    clipperName: range.clipperName || (existing && existing.clipperName) || actor.clipperName || state.me.name,
    helperId: (range.helperId != null ? range.helperId : (existing ? existing.helperId : actor.helperId)) || null,
    helperName: range.helperName != null ? range.helperName : ((existing && existing.helperName) || actor.helperName || ''),
    inTime: Math.min(inTime, outTime),
    outTime: Math.max(inTime, outTime),
    pendingOut: !!range.pendingOut,
    status: range.status || (existing && existing.status) || 'done',
    streamKey: range.streamKey || (existing && existing.streamKey) || 'default',
    createdAt: range.createdAt || (existing && existing.createdAt) || nowIso(),
    updatedAt: nowIso(),
    postCaption: (range.postCaption != null ? range.postCaption : (existing && existing.postCaption)) || '',
    postCaptionUpdatedAt: Number(range.postCaptionUpdatedAt != null ? range.postCaptionUpdatedAt : (existing && existing.postCaptionUpdatedAt)) || 0,
    fileName: range.fileName || (existing && existing.fileName) || '',
    filePath: range.filePath || (existing && existing.filePath) || '',
    displayPath: range.displayPath || (existing && existing.displayPath) || '',
    postThumbnailDataUrl: range.postThumbnailDataUrl || (existing && existing.postThumbnailDataUrl) || '',
    sentBy: (range.sentBy != null ? range.sentBy : (existing && existing.sentBy)) || '',
    sentByName: (range.sentByName != null ? range.sentByName : (existing && existing.sentByName)) || '',
    sentAt: Number(range.sentAt != null ? range.sentAt : (existing && existing.sentAt)) || 0
  };

  var idx = -1;
  for (var j = 0; j < state.clipRanges.length; j++) {
    if (state.clipRanges[j].id === next.id) { idx = j; break; }
  }
  if (idx >= 0) {
    state.clipRanges[idx] = Object.assign({}, state.clipRanges[idx], next);
  } else {
    state.clipRanges.push(next);
  }
  bumpRangesVersion();
  emit();

  if (state.lobby && client) client.upsertRange(next);
  return next;
}

function removeClipRange(rangeId) {
  var id = String(rangeId || '').trim();
  if (!id) return false;
  var before = state.clipRanges.length;
  state.clipRanges = state.clipRanges.filter(function (r) { return String(r.id || '') !== id; });
  if (before === state.clipRanges.length) return false;
  bumpRangesVersion();
  emit();
  if (state.lobby && client) client.removeRange(id);
  return true;
}

function _deliveryPrecheck(clip) {
  if (!state.lobby) return { ok: false, reason: 'no-lobby', message: 'Join a lobby first' };
  if (!client) return { ok: false, reason: 'no-client', message: 'Not connected to server' };
  if (myRole() !== 'helper') return { ok: false, reason: 'not-helper', message: 'Switch role to Helper first' };
  if (!clip || !clip.id) return { ok: false, reason: 'no-clip', message: 'Clip is missing or invalid' };
  var target = myAssistUserId() || '';
  if (!target) return { ok: false, reason: 'no-target', message: 'Pick an assigned Clipper first' };
  return { ok: true, target: target };
}

function sendClipDelivery(clip) {
  var pre = _deliveryPrecheck(clip);
  if (!pre.ok) {
    setStatus(pre.message);
    dlog('COLLAB:SEND', 'sendClipDelivery blocked', { reason: pre.reason, clipId: clip && clip.id });
    return Promise.resolve({ success: false, reason: pre.reason, message: pre.message });
  }
  var payload = window.Delivery ? window.Delivery.buildClipDeliveryPayload(clip) : {};
  var payloadJson = JSON.stringify(payload);
  dlog('COLLAB:SEND', 'sendClipDelivery', { clipId: clip.id, toUserId: pre.target, name: clip.name });
  client.createDelivery({
    fromUserId: state.me.id,
    fromUserName: state.me.name || '',
    fromUserColor: state.me.color || '',
    toUserId: pre.target,
    type: 'clip',
    rangeId: clip.id,
    payload: payload
  });
  clip._lastSentPayloadJson = payloadJson;
  return Promise.resolve({ success: true });
}

function resendClipDelivery(clip) {
  var pre = _deliveryPrecheck(clip);
  if (!pre.ok) {
    dlog('COLLAB:SEND', 'resendClipDelivery blocked', { reason: pre.reason, clipId: clip && clip.id });
    return Promise.resolve({ success: false, reason: pre.reason, message: pre.message });
  }
  var payload = window.Delivery ? window.Delivery.buildClipDeliveryPayload(clip) : {};
  var payloadJson = JSON.stringify(payload);
  if (clip._lastSentPayloadJson === payloadJson) return Promise.resolve({ success: true, skipped: true });
  dlog('COLLAB:SEND', 'resendClipDelivery', { clipId: clip.id, toUserId: pre.target });
  client.createDelivery({
    fromUserId: state.me.id,
    fromUserName: state.me.name || '',
    fromUserColor: state.me.color || '',
    toUserId: pre.target,
    type: 'clipUpdate',
    rangeId: clip.id,
    payload: payload
  });
  clip._lastSentPayloadJson = payloadJson;
  return Promise.resolve({ success: true });
}

function unsendClipDelivery(clip) {
  var pre = _deliveryPrecheck(clip);
  if (!pre.ok) {
    dlog('COLLAB:SEND', 'unsendClipDelivery blocked', { reason: pre.reason, clipId: clip && clip.id });
    return Promise.resolve({ success: false, reason: pre.reason, message: pre.message });
  }
  dlog('COLLAB:SEND', 'unsendClipDelivery', { clipId: clip.id, toUserId: pre.target });
  client.createDelivery({
    fromUserId: state.me.id,
    fromUserName: state.me.name || '',
    fromUserColor: state.me.color || '',
    toUserId: pre.target,
    type: 'clipUnsend',
    rangeId: clip.id,
    payload: null
  });
  return Promise.resolve({ success: true });
}

function consumeMyDeliveries() {
  if (!_inboundDeliveries.length) return Promise.resolve([]);
  var batch = _inboundDeliveries.splice(0, _inboundDeliveries.length);
  // Ack server so the row flips to delivered=1 in SQLite.
  var ids = [];
  for (var i = 0; i < batch.length; i++) if (batch[i] && batch[i].id) ids.push(batch[i].id);
  if (ids.length && client && client.consumeDeliveries) {
    try { client.consumeDeliveries(ids); } catch (_) {}
  }
  dlog('COLLAB:RECV', 'consumeMyDeliveries drained', { count: batch.length });
  return Promise.resolve(batch);
}

function setMemberRole(targetId, role) {
  if (!state.lobby || !client) return null;
  dlog('ACTION', 'setMemberRole', { targetId: targetId, role: role });
  var isRthub = !!(window.RthubClient && client instanceof window.RthubClient);
  if (isRthub) {
    // rthub spec has no server-authoritative role assignment. Each peer
    // self-sets via peerProfile; promoting others is deferred until partner
    // ships a setRole frame.
    if (targetId === state.me.id) {
      updateLocalProfile({ role: role });
      return Promise.resolve({ success: true });
    }
    return Promise.resolve({ success: false, code: 'deferred', message: 'role assignment for other peers not yet supported' });
  }
  client.setRole(targetId, role);
  return Promise.resolve({ success: true });
}

function assistClipper(clipperId) {
  if (!state.lobby || !client) return;
  dlog('ACTION', 'assistClipper', { clipperId: clipperId });
  client.setAssist(clipperId, 'helper');
}

function stopAssisting() {
  if (!state.lobby || !client) return;
  dlog('ACTION', 'stopAssisting');
  client.setAssist(null);
}

var _rangesVersion = 0;
var _indicatorCache = { v: -1, t: -1, result: null };
function bumpRangesVersion() { _rangesVersion++; }

function getIndicatorAtTime(timeSec) {
  if (!isFinite(timeSec)) return null;
  var t = Math.round(timeSec * 10) / 10;
  if (_indicatorCache.v === _rangesVersion && _indicatorCache.t === t) {
    return _indicatorCache.result;
  }
  var result;
  if (utils && utils.buildIndicatorAtTime) {
    result = utils.buildIndicatorAtTime(state.clipRanges, timeSec);
  } else {
    var names = [];
    for (var i = 0; i < state.clipRanges.length; i++) {
      var r = state.clipRanges[i];
      if (!r) continue;
      if (timeSec < r.inTime || timeSec > r.outTime) continue;
      var label = (r.clipperName || r.userName || 'Editor');
      if (r.helperName) label += ' (' + r.helperName + ')';
      if (names.indexOf(label) === -1) names.push(label);
    }
    result = names.length ? {
      text: 'Clipped/Being Clipped by ' + names.join(', '),
      names: names
    } : null;
  }
  _indicatorCache = { v: _rangesVersion, t: t, result: result };
  return result;
}

function getClipRanges() {
  return state.clipRanges.slice();
}

function subscribe(fn) {
  listeners.push(fn);
  return function () {
    listeners = listeners.filter(function (f) { return f !== fn; });
  };
}

async function simulate() {
  if (!state.lobby) {
    state.lobby = { code: 'SIM-LOCAL', name: 'Sim Lobby', members: [], chat: [], clipRanges: [], deliveries: [] };
    setStage('in-lobby');
  }
  upsertClipRange({ id: 'sim_mark', userId: 'sim_a', userName: 'Editor A', inTime: 35, outTime: 74, status: 'marking' });
  upsertClipRange({ id: 'sim_queue', userId: 'sim_b', userName: 'Editor B', inTime: 102, outTime: 136, status: 'queued' });
  upsertClipRange({ id: 'sim_done', userId: 'sim_a', userName: 'Editor A', inTime: 180, outTime: 208, status: 'done' });
  addChat('clip points live in this lobby now', 'Editor A');
}

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escName(v) {
  var s = String(v == null ? '' : v);
  if (s.indexOf('[DEV] ') === 0) {
    return '<span class="dev-tag">[DEV]</span> ' + esc(s.slice(6));
  }
  return esc(s);
}

function roleColor(role) {
  if (role === 'clipper') return 'var(--accent-l, #b58cff)';
  if (role === 'helper')  return 'var(--green, #33d69f)';
  return 'var(--dim, #8b9099)';
}

function renderMembers(listEl) {
  if (!listEl) return;
  if (!state.members.length) {
    listEl.innerHTML = '<div class="collab-empty">No editors yet</div>';
    return;
  }
  var g = groupMembers(state.members);
  var meId = state.me.id;
  var html = [];

  function memberRow(m, indent, isMe) {
    var color = m.color || getUserColor(m.id, m.name);
    var avatarStyle = m.pfpDataUrl ? "background-image:url('" + m.pfpDataUrl + "');" : 'background:' + color + ';';
    var nameColor = roleColor(m.role || 'viewer');
    var indentClass = indent ? ' collab-member-row--indented' : '';
    var statusDot = m.role === 'helper'
      ? '<span class="collab-status-dot collab-status-helper" title="Assisting"></span>'
      : '';
    return '<div class="collab-member-row' + indentClass + '" data-user-id="' + esc(m.id) + '">' +
      '<div class="collab-member-avatar" style="' + avatarStyle + '"></div>' +
      '<div class="collab-member-meta">' +
        '<div class="collab-member-name" style="color:' + nameColor + '">' +
          escName(m.name) +
          statusDot +
          (isMe ? '<span class="collab-you-tag">you</span>' : '') +
        '</div>' +
        (m.xHandle ? '<div class="collab-member-handle">@' + esc(m.xHandle) + '</div>' : '') +
      '</div>' +
    '</div>';
  }

  function sectionHeader(label, count) {
    return '<div class="collab-group-title">' +
      '<span>' + esc(label) + '</span>' +
      '<span class="collab-group-count">' + count + '</span>' +
    '</div>';
  }

  // CLIPPERS section (clippers + their indented helpers)
  if (g.clippers.length || g.orphanHelpers.length) {
    html.push(sectionHeader('CLIPPERS', g.clippers.length));
    for (var ci = 0; ci < g.clippers.length; ci++) {
      var c = g.clippers[ci];
      html.push(memberRow(c, false, c.id === meId));
      for (var hi = 0; hi < c.helpers.length; hi++) {
        var h = c.helpers[hi];
        html.push(memberRow(h, true, h.id === meId));
      }
    }
    for (var oi = 0; oi < g.orphanHelpers.length; oi++) {
      var oh = g.orphanHelpers[oi];
      html.push(memberRow(oh, false, oh.id === meId));
    }
  }

  // VIEWERS section
  if (g.viewers.length) {
    html.push(sectionHeader('VIEWERS', g.viewers.length));
    for (var vi = 0; vi < g.viewers.length; vi++) {
      html.push(memberRow(g.viewers[vi], false, g.viewers[vi].id === meId));
    }
  }

  listEl.innerHTML = html.join('');

  if (!listEl._profileClickBound) {
    listEl.addEventListener('click', function (e) {
      var row = e.target.closest('[data-user-id]');
      if (!row) return;
      openProfilePopover(row.dataset.userId, row);
    });
    listEl._profileClickBound = true;
  }
}

function openProfilePopover(userId, anchorEl) {
  var m = findMemberById(userId);
  if (!m) return;
  var existing = document.querySelector('.profile-popover');
  if (existing) existing.remove();

  var isSelf = userId === state.me.id;
  var iAmClipper = myRole() === 'clipper';
  var iAmHelper = myRole() === 'helper';
  var iAmAssistingThis = myAssistUserId() === userId;
  var color = m.color || getUserColor(m.id, m.name);

  var pop = document.createElement('div');
  pop.className = 'profile-popover';

  var avatarHtml = m.pfpDataUrl
    ? "<div class=\"profile-popover-avatar\" style=\"background-image:url('" + m.pfpDataUrl + "');\"></div>"
    : '<div class="profile-popover-avatar" style="background:' + color + ';"></div>';
  var xHtml = m.xHandle
    ? '<a href="#" class="profile-popover-x" data-handle="' + esc(m.xHandle) + '">@' + esc(m.xHandle) + '</a>'
    : '<span class="profile-popover-x-empty">No X handle</span>';

  pop.innerHTML = avatarHtml +
    '<div class="profile-popover-name" style="color:' + color + '">' + esc(m.name || 'Editor') + '</div>' +
    '<div class="profile-popover-role">' + esc(m.role || '') + '</div>' +
    xHtml;

  var actions = document.createElement('div');
  actions.className = 'profile-popover-actions';

  function addAction(label, btnClass, fn) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn ' + btnClass;
    btn.textContent = label;
    btn.addEventListener('click', function () { fn(); pop.remove(); });
    actions.appendChild(btn);
  }

  if (isSelf) {
    if (iAmHelper) {
      addAction('Stop Assisting', 'btn-ghost', stopAssisting);
    }
    // Viewer/clipper self -> no action; promotion/demotion is done by another clipper.
  } else if (m.role === 'clipper') {
    if (iAmAssistingThis) {
      addAction('Stop Assisting', 'btn-ghost', stopAssisting);
    } else if (myRole() === 'viewer' || myRole() === 'helper') {
      addAction('Assist ' + esc(m.name || 'Clipper'), 'btn-primary', function () { assistClipper(userId); });
    }
    if (iAmClipper) {
      addAction('Demote to Viewer', 'btn-ghost btn-xs', function () { setMemberRole(userId, 'viewer'); });
    }
  } else if (iAmClipper) {
    if (m.role !== 'clipper') {
      addAction('Promote to Clipper', 'btn-ghost btn-xs', function () { setMemberRole(userId, 'clipper'); });
    }
    if (m.role !== 'viewer') {
      addAction('Demote to Viewer', 'btn-ghost btn-xs', function () { setMemberRole(userId, 'viewer'); });
    }
  }

  if (actions.children.length) pop.appendChild(actions);
  document.body.appendChild(pop);

  var rect = anchorEl.getBoundingClientRect();
  pop.style.top = (rect.bottom + 6) + 'px';
  pop.style.left = Math.max(6, Math.min(window.innerWidth - 260, rect.left)) + 'px';

  var xAnchor = pop.querySelector('.profile-popover-x');
  if (xAnchor) {
    xAnchor.addEventListener('click', function (e) {
      e.preventDefault();
      if (window.clipper && window.clipper.openExternal) {
        window.clipper.openExternal('https://x.com/' + xAnchor.dataset.handle);
      }
    });
  }

  setTimeout(function () {
    function onDoc(e) {
      if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', onDoc); }
    }
    document.addEventListener('click', onDoc);
  }, 0);
}

function renderMemberChips() {
  var chips = document.getElementById('collabMemberChips');
  if (!chips) return;
  if (!state.members.length) {
    chips.innerHTML = '';
    return;
  }
  chips.innerHTML = state.members.map(function (m) {
    var color = getUserColor(m.id, m.name);
    return '<span class="collab-chip" style="color:' + color + ';border-color:' + alpha(color, 0.5) + ';background:' + alpha(color, 0.12) + '">' + esc(m.name) + '</span>';
  }).join('');
}

function renderStatus() {
  var status = document.getElementById('collabSessionStatus');
  if (status) status.textContent = statusText || '';
  var connMsg = document.getElementById('collabConnStatusMsg');
  if (connMsg && connStage === 'offline') connMsg.textContent = statusText || '';
  else if (connMsg) connMsg.textContent = '';
}

function renderSession() {
  var members = document.getElementById('collabMembersList');
  renderStatus();

  if (state.lobby) {
    var nameEl = document.getElementById('lobbyActiveName');
    var codeEl = document.getElementById('lobbyActiveCode');
    var countEl = document.getElementById('lobbyMemberCount');
    if (nameEl) nameEl.textContent = state.lobby.name || 'Lobby';
    if (codeEl) codeEl.textContent = state.lobby.code || '------';
    if (countEl) countEl.textContent = String(state.members.length || 0);
  }

  renderMembers(members);
}

function renderChat() {
  var chatList = document.getElementById('collabChatList');
  if (!chatList) return;
  if (!state.chat.length) {
    chatList.innerHTML = '<div class="collab-empty">Lobby chat empty</div>';
    return;
  }
  chatList.innerHTML = state.chat.slice(-150).map(function (msg) {
    var color = getUserColor(msg.userId, msg.userName);
    return '<div class="collab-chat-item"><b class="collab-name" style="color:' + color + '">' + escName(msg.userName) + ':</b> ' + esc(msg.text) + '</div>';
  }).join('');
  chatList.scrollTop = chatList.scrollHeight;
}

function fmtTime(sec) {
  sec = Math.floor(Math.max(0, sec));
  var h = Math.floor(sec / 3600);
  var m = Math.floor((sec % 3600) / 60);
  var s = sec % 60;
  function p(n) { return String(n).padStart(2, '0'); }
  return p(h) + ':' + p(m) + ':' + p(s);
}

function renderActivity() {
  var list = document.getElementById('collabActivityList');
  if (!list) return;
  if (!state.clipRanges.length) {
    list.innerHTML = '<div class="collab-empty">No clip points yet</div>';
    return;
  }
  var sorted = state.clipRanges.slice().sort(function (a, b) {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
  list.innerHTML = sorted.map(function (r) {
    var label = utils && utils.getDisplayActor ? utils.getDisplayActor(r) : (r.userName || 'Editor');
    var color = getUserColor(r.clipperId || r.userId, label);
    var verb = utils && utils.getActivityVerb ? utils.getActivityVerb(r.status) : (r.status || 'updated');
    var outMissing = !!r.pendingOut;
    var inTime = Number(r.inTime);
    var outTime = Number(r.outTime);
    var inHtml = isFinite(inTime)
      ? '<button class="collab-time-link" data-time="' + String(inTime) + '">' + fmtTime(inTime) + '</button>'
      : '<span class="collab-time-link missing">--:--:--</span>';
    var outHtml = (!outMissing && isFinite(outTime))
      ? '<button class="collab-time-link" data-time="' + String(outTime) + '">' + fmtTime(outTime) + '</button>'
      : '<span class="collab-time-link missing">...</span>';
    return '<div class="collab-list-item">' +
      '<span><span class="collab-name" style="color:' + color + '">' + escName(label) + '</span> - ' + esc(verb) + '</span>' +
      '<small class="collab-activity-meta">(in: ' + inHtml + ') (out: ' + outHtml + ')</small>' +
      '</div>';
  }).join('');
}

function renderAccountCard() {
  var nameEl = document.getElementById('accountName');
  var handleEl = document.getElementById('accountHandle');
  var avatarEl = document.getElementById('accountAvatar');
  if (!nameEl || !handleEl || !avatarEl) return;
  nameEl.textContent = state.me.name || 'Guest';
  var color = state.me.color || getUserColor(state.me.id, state.me.name);
  if (color) nameEl.style.color = color;
  handleEl.textContent = state.me.xHandle ? '@' + state.me.xHandle : '';
  avatarEl.style.backgroundImage = state.me.pfpDataUrl ? 'url(' + JSON.stringify(state.me.pfpDataUrl) + ')' : '';
}

function openProfileModal() {
  var overlay = document.getElementById('profileModal');
  if (!overlay) return;
  var nameInput = document.getElementById('profileNameInput');
  var xInput = document.getElementById('profileXHandleInput');
  var colorInput = document.getElementById('profileColorInput');
  var preview = document.getElementById('profilePfpPreview');
  if (nameInput) nameInput.value = state.me.name || '';
  if (xInput) xInput.value = state.me.xHandle || '';
  if (colorInput) colorInput.value = state.me.color || '#5bb1ff';
  if (preview) preview.style.backgroundImage = state.me.pfpDataUrl ? 'url(' + JSON.stringify(state.me.pfpDataUrl) + ')' : '';
  overlay.hidden = false;
}

function closeProfileModal() {
  var overlay = document.getElementById('profileModal');
  if (overlay) overlay.hidden = true;
}

function bindProfileUi() {
  var editBtn = document.getElementById('accountEditBtn');
  if (editBtn) editBtn.addEventListener('click', function () {
    dlog('ACTION', 'profile open modal');
    openProfileModal();
  });
  var closeBtn = document.getElementById('profileModalClose');
  if (closeBtn) closeBtn.addEventListener('click', function () {
    dlog('ACTION', 'profile close modal');
    closeProfileModal();
  });
  var saveBtn = document.getElementById('profileSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', function () {
    var nameInput = document.getElementById('profileNameInput');
    var xInput = document.getElementById('profileXHandleInput');
    var colorInput = document.getElementById('profileColorInput');
    var patch = {
      name: nameInput ? nameInput.value : undefined,
      xHandle: xInput ? xInput.value : undefined,
      color: colorInput ? colorInput.value : undefined
    };
    dlog('ACTION', 'profile save', patch);
    updateLocalProfile(patch);
    closeProfileModal();
  });
  var pfpBtn = document.getElementById('profilePfpBtn');
  var pfpFile = document.getElementById('profilePfpFile');
  var pfpClear = document.getElementById('profilePfpClearBtn');
  if (pfpBtn && pfpFile) pfpBtn.addEventListener('click', function () {
    dlog('ACTION', 'profile pick pfp');
    pfpFile.click();
  });
  if (pfpFile) pfpFile.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    dlog('ACTION', 'profile pfp chosen', { size: file.size, type: file.type });
    if (file.size > 200000) { alert('Image must be under 200KB'); return; }
    var reader = new FileReader();
    reader.onload = function () {
      var dataUrl = String(reader.result || '');
      if (!window.Profile || !window.Profile.validatePfpDataUrl(dataUrl, 256000)) {
        alert('Invalid image'); return;
      }
      updateLocalProfile({ pfpDataUrl: dataUrl });
      var preview = document.getElementById('profilePfpPreview');
      if (preview) preview.style.backgroundImage = 'url(' + JSON.stringify(dataUrl) + ')';
    };
    reader.readAsDataURL(file);
  });
  if (pfpClear) pfpClear.addEventListener('click', function () {
    dlog('ACTION', 'profile pfp clear');
    updateLocalProfile({ pfpDataUrl: '' });
    var preview = document.getElementById('profilePfpPreview');
    if (preview) preview.style.backgroundImage = '';
  });
}

function renderAll() {
  renderSession();
  renderChat();
  renderActivity();
  renderMemberChips();
  renderAccountCard();
}

function bindCollabTabs() {
  var tabs = document.querySelectorAll('.collab-tab[data-tab]');
  tabs.forEach(function (tabBtn) {
    tabBtn.addEventListener('click', function () {
      var key = tabBtn.dataset.tab;
      dlog('ACTION', 'collab tab', { tab: key });
      tabs.forEach(function (t) { t.classList.toggle('active', t === tabBtn); });
      document.querySelectorAll('.collab-tab-panel[data-tab-panel]').forEach(function (panel) {
        panel.hidden = panel.dataset.tabPanel !== key;
      });
    });
  });
}

function bindUi() {
  var leaveBtn = document.getElementById('collabLeaveBtn');
  var sendBtn = document.getElementById('collabChatSend');
  var chatInput = document.getElementById('collabChatInput');
  var activityList = document.getElementById('collabActivityList');
  var connectBtn = document.getElementById('collabConnectBtn');
  var resetBtn = document.getElementById('collabResetUrlBtn');
  var serverUrlInput = document.getElementById('collabServerUrl');
  var sessionIdInput = document.getElementById('collabSessionIdInput');

  bindCollabTabs();

  // Prefill server URL + sessionId from disk config
  if (window.clipper && window.clipper.serverGetConfig) {
    loggedServerGetConfig().then(function (cfg) {
      var defaultUrl = window.RthubConfig
        ? window.RthubConfig.defaultRthubUrl()
        : 'wss://rthub.1626.workers.dev/ws';
      if (serverUrlInput && !serverUrlInput.value) {
        serverUrlInput.value = (cfg && cfg.url) || defaultUrl;
      }
      if (sessionIdInput && !sessionIdInput.value) {
        sessionIdInput.value = (cfg && cfg.sessionId) || state.lastCode || '';
      }
    });
  }

  if (connectBtn) {
    connectBtn.onclick = function () {
      var url = serverUrlInput ? serverUrlInput.value.trim() : '';
      var sid = sessionIdInput ? sessionIdInput.value.trim() : '';
      dlog('ACTION', 'collab connect', { url: url, sessionId: sid });
      connect(url, { autoConnect: true, sessionId: sid });
    };
  }
  if (resetBtn && serverUrlInput) {
    resetBtn.onclick = function () {
      var newUrl = window.RthubConfig
        ? window.RthubConfig.defaultRthubUrl()
        : 'wss://rthub.1626.workers.dev/ws';
      dlog('ACTION', 'collab reset url', { url: newUrl });
      serverUrlInput.value = newUrl;
    };
  }

  var copyBtn = document.getElementById('lobbyCopyCodeBtn');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    var code = state.lobby && state.lobby.code;
    dlog('ACTION', 'collab copy code', { code: code });
    if (code && navigator.clipboard) {
      navigator.clipboard.writeText(code);
      setStatus('Code copied');
    }
  });

  if (leaveBtn) leaveBtn.onclick = function () {
    dlog('ACTION', 'collab leave', { code: state.lobby && state.lobby.code });
    leaveLobby();
  };

  function sendChat(source) {
    if (!chatInput) return;
    var text = chatInput.value.trim();
    if (!text) return;
    dlog('ACTION', 'collab send chat', { len: text.length, source: source || 'click' });
    addChat(text, state.me.name);
    chatInput.value = '';
  }
  if (sendBtn) sendBtn.onclick = function () { sendChat('click'); };
  if (chatInput) {
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendChat('enter');
    });
  }
  if (activityList) {
    activityList.addEventListener('click', function (e) {
      var btn = e.target.closest('.collab-time-link[data-time]');
      if (!btn) return;
      var time = Number(btn.getAttribute('data-time'));
      if (!isFinite(time)) return;
      dlog('ACTION', 'collab activity jump', { time: time });
      if (window._panelBus && window._panelBus.emit) {
        window._panelBus.emit('collab:jump-to-time', { time: time });
      }
    });
  }
}


function setState(nextState) {
  state = {
    me: nextState.me || state.me,
    lobby: nextState.lobby || null,
    members: Array.isArray(nextState.members) ? nextState.members : [],
    chat: Array.isArray(nextState.chat) ? nextState.chat : [],
    clipRanges: Array.isArray(nextState.clipRanges) ? nextState.clipRanges : [],
    lastCode: nextState.lastCode || state.lastCode
  };
  emit();
}

window.CollabUI = {
  getState: function () { return state; },
  setState: setState,
  updateLocalProfile: updateLocalProfile,
  connect: connect,
  disconnect: disconnect,
  leaveLobby: leaveLobby,
  refreshLobby: refreshLobby,
  addChat: addChat,
  upsertClipRange: upsertClipRange,
  removeClipRange: removeClipRange,
  getClipRanges: getClipRanges,
  getIndicatorAtTime: getIndicatorAtTime,
  getMarkContext: getMarkContext,
  assistClipper: assistClipper,
  stopAssisting: stopAssisting,
  getUserColor: getUserColor,
  subscribe: subscribe,
  simulate: simulate,
  sendClipDelivery: sendClipDelivery,
  resendClipDelivery: resendClipDelivery,
  unsendClipDelivery: unsendClipDelivery,
  consumeMyDeliveries: consumeMyDeliveries,
  setMemberRole: setMemberRole,
  myRole: myRole,
  myMember: myMember,
  canMarkClips: canMarkClipsLocal,
  canSendDelivery: canSendDeliveryLocal,
  canConsumeDeliveries: canConsumeDeliveriesLocal,
  // Realtime sync senders.
  sendTimeline:  function (ms)              { if (client && client.sendTimeline)  client.sendTimeline(ms); },
  sendPlayback:  function (state, ms, rate) { if (client && client.sendPlayback)  client.sendPlayback(state, ms, rate); },
  sendSelection: function (ids)             { if (client && client.sendSelection) client.sendSelection(ids); },
  sendCursor:    function (ms)              { if (client && client.sendCursor)    client.sendCursor(ms); },
  sendClipRange: function (inMs, outMs)     { if (client && client.sendClipRange) client.sendClipRange(inMs, outMs); }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    bindUi();
    bindProfileUi();
    setStage('offline');
    renderAll();
  });
} else {
  bindUi();
  bindProfileUi();
  setStage('offline');
  renderAll();
}

if (window._panelRegistry && window._panelRegistry.registerLifecycle) {
  window._panelRegistry.registerLifecycle('collab', {
    mount: function () { renderAll(); },
    saveState: function () {
      var input = document.getElementById('collabChatInput');
      return { draftText: input ? input.value : '' };
    },
    restoreState: function (s) {
      if (!s) return;
      var input = document.getElementById('collabChatInput');
      if (input && s.draftText) input.value = s.draftText;
    }
  });
}

})();

(function () {
'use strict';

var STORAGE_KEY = 'ch_collab_ui_v3';
var POLL_MS = 1200;
var listeners = [];
var pollTimer = null;
var statusText = '';

var NAME_COLORS = [
  '#5bb1ff', '#ff7a59', '#33d69f', '#ffcf5a', '#f08fff',
  '#7ee3ff', '#ff9e7d', '#7be08b', '#ffd16e', '#c8a0ff'
];

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

function loadPrefs() {
  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) || {};
  } catch (_) {
    return {};
  }
}

var prefs = loadPrefs();
var state = {
  me: {
    id: makeId('u'),
    name: normalizeName(prefs.meName || 'You')
  },
  lobby: null,
  members: [],
  chat: [],
  clipRanges: [],
  lastCode: safeCode(prefs.lastCode || '')
};

function savePrefs() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      meName: state.me.name,
      lastCode: state.lobby ? state.lobby.code : state.lastCode
    }));
  } catch (_) {}
}

function getMemberColorMap() {
  var list = state.members.slice().sort(function (a, b) {
    var aj = a.joinedAt || '';
    var bj = b.joinedAt || '';
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

function emit() {
  renderAll();
  savePrefs();
  for (var i = 0; i < listeners.length; i++) listeners[i](state);
}

function setStatus(msg) {
  statusText = msg || '';
  renderSession();
}

function applyLobby(lobby) {
  if (!lobby) {
    state.lobby = null;
    state.members = [];
    state.chat = [];
    state.clipRanges = [];
    stopPolling();
    emit();
    return;
  }
  state.lobby = {
    id: lobby.id || null,
    code: safeCode(lobby.code || ''),
    name: String(lobby.name || 'Collab Lobby'),
    password: String(lobby.password || ''),
    hostId: lobby.hostId || null,
    createdAt: lobby.createdAt || nowIso()
  };
  state.lastCode = state.lobby.code;
  state.members = Array.isArray(lobby.members) ? lobby.members.slice() : [];
  state.chat = Array.isArray(lobby.chat) ? lobby.chat.slice() : [];
  state.clipRanges = Array.isArray(lobby.clipRanges) ? lobby.clipRanges.slice() : [];
  startPolling();
  emit();
}

function updateMeName(name) {
  var clean = normalizeName(name);
  if (!clean) return false;
  state.me.name = clean;
  savePrefs();
  return true;
}

async function createLobby(name, password, code) {
  if (!window.clipper || !window.clipper.collabCreateLobby) {
    setStatus('Collab backend missing');
    return null;
  }
  var res = await window.clipper.collabCreateLobby({
    name: name,
    password: password || '',
    code: safeCode(code || ''),
    user: { id: state.me.id, name: state.me.name }
  });
  if (!res || !res.success) {
    setStatus((res && res.error) ? res.error : 'Create failed');
    return null;
  }
  applyLobby(res.lobby);
  setStatus('Joined Lobby · code ' + state.lobby.code);
  return state.lobby;
}

async function joinLobby(code, password) {
  if (!window.clipper || !window.clipper.collabJoinLobby) {
    setStatus('Collab backend missing');
    return null;
  }
  var cleanCode = safeCode(code);
  if (!cleanCode) {
    setStatus('Enter join code');
    return null;
  }
  var res = await window.clipper.collabJoinLobby({
    code: cleanCode,
    password: password || '',
    user: { id: state.me.id, name: state.me.name }
  });
  if (!res || !res.success) {
    setStatus((res && res.error) ? res.error : 'Join failed');
    return null;
  }
  applyLobby(res.lobby);
  setStatus('Joined Lobby · code ' + state.lobby.code);
  return state.lobby;
}

async function leaveLobby() {
  if (!state.lobby) return;
  if (window.clipper && window.clipper.collabLeaveLobby) {
    await window.clipper.collabLeaveLobby({
      code: state.lobby.code,
      userId: state.me.id
    });
  }
  applyLobby(null);
  setStatus('No active lobby');
}

async function refreshLobby() {
  if (!state.lobby || !window.clipper || !window.clipper.collabGetLobby) return null;
  var res = await window.clipper.collabGetLobby({
    code: state.lobby.code,
    user: { id: state.me.id, name: state.me.name }
  });
  if (!res || !res.success) return null;
  applyLobby(res.lobby);
  return res.lobby;
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(function () {
    refreshLobby();
  }, POLL_MS);
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

async function addChat(text, userName) {
  var msg = String(text || '').trim();
  if (!msg || !state.lobby) return null;
  if (!updateMeName(userName || state.me.name)) return null;
  if (!window.clipper || !window.clipper.collabAddChat) return null;
  var res = await window.clipper.collabAddChat({
    code: state.lobby.code,
    text: msg,
    user: { id: state.me.id, name: state.me.name }
  });
  if (res && res.success) applyLobby(res.lobby);
  else if (res && res.error) setStatus(res.error);
  return res && res.success ? res.lobby : null;
}

function upsertClipRange(range) {
  if (!range || !isFinite(range.inTime) || !isFinite(range.outTime)) return null;
  var inTime = Number(range.inTime);
  var outTime = Number(range.outTime);
  var next = {
    id: range.id || makeId('range'),
    userId: range.userId || state.me.id,
    userName: range.userName || state.me.name,
    inTime: Math.min(inTime, outTime),
    outTime: Math.max(inTime, outTime),
    status: range.status || 'done',
    streamKey: range.streamKey || 'default',
    createdAt: range.createdAt || nowIso(),
    updatedAt: nowIso()
  };

  var idx = -1;
  for (var i = 0; i < state.clipRanges.length; i++) {
    if (state.clipRanges[i].id === next.id) { idx = i; break; }
  }
  if (idx >= 0) {
    next.createdAt = state.clipRanges[idx].createdAt || next.createdAt;
    state.clipRanges[idx] = next;
  } else {
    state.clipRanges.push(next);
  }
  emit();

  if (state.lobby && window.clipper && window.clipper.collabUpsertRange) {
    window.clipper.collabUpsertRange({
      code: state.lobby.code,
      range: next,
      user: { id: state.me.id, name: state.me.name }
    }).then(function (res) {
      if (res && res.success) applyLobby(res.lobby);
      else if (res && res.error) setStatus(res.error);
    });
  }
  return next;
}

function getIndicatorAtTime(timeSec) {
  if (!isFinite(timeSec)) return null;
  var names = [];
  for (var i = 0; i < state.clipRanges.length; i++) {
    var r = state.clipRanges[i];
    if (timeSec >= r.inTime && timeSec <= r.outTime) {
      if (names.indexOf(r.userName) === -1) names.push(r.userName);
    }
  }
  if (!names.length) return null;
  return {
    text: 'Clipped/Being Clipped by ' + names.join(', '),
    names: names
  };
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
    await createLobby('Sim Lobby', 'demo', '');
  }
  upsertClipRange({ id: 'sim_mark', userId: 'sim_a', userName: 'Editor A', inTime: 35, outTime: 74, status: 'marking' });
  upsertClipRange({ id: 'sim_queue', userId: 'sim_b', userName: 'Editor B', inTime: 102, outTime: 136, status: 'queued' });
  upsertClipRange({ id: 'sim_done', userId: 'sim_a', userName: 'Editor A', inTime: 180, outTime: 208, status: 'done' });
  addChat('clip points live in this lobby now', 'Editor A');
}

function esc(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMembers(listEl) {
  if (!listEl) return;
  if (!state.members.length) {
    listEl.innerHTML = '<div class="collab-empty">No editors yet</div>';
    return;
  }
  listEl.innerHTML = state.members.map(function (m) {
    var color = getUserColor(m.id, m.name);
    return '<div class="collab-list-item"><span class="collab-name" style="color:' + color + '">' + esc(m.name) + '</span><small>' + esc(m.role || 'editor') + '</small></div>';
  }).join('');
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

function renderSession() {
  var status = document.getElementById('collabSessionStatus');
  var members = document.getElementById('collabMembersList');
  var codeInput = document.getElementById('collabLobbyCodeInput');
  var profileInput = document.getElementById('collabProfileNameInput');
  if (status) {
    if (statusText) status.textContent = statusText;
    else if (state.lobby) status.textContent = state.lobby.name + ' · code ' + state.lobby.code;
    else status.textContent = 'No active lobby';
  }
  if (profileInput && document.activeElement !== profileInput) {
    profileInput.value = state.me.name;
  }
  if (codeInput) {
    if (state.lobby && state.lobby.code) codeInput.value = state.lobby.code;
    else if (state.lastCode && !codeInput.value) codeInput.value = state.lastCode;
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
    return '<div class="collab-chat-item"><b class="collab-name" style="color:' + color + '">' + esc(msg.userName) + ':</b> ' + esc(msg.text) + '</div>';
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
    var color = getUserColor(r.userId, r.userName);
    return '<div class="collab-list-item"><span><span class="collab-name" style="color:' + color + '">' + esc(r.userName) + '</span> · ' + esc(r.status) + '</span><small>' + fmtTime(r.inTime) + ' - ' + fmtTime(r.outTime) + '</small></div>';
  }).join('');
}

function renderAll() {
  renderSession();
  renderChat();
  renderActivity();
  renderMemberChips();
}

function bindUi() {
  var createBtn = document.getElementById('collabCreateBtn');
  var joinBtn = document.getElementById('collabJoinBtn');
  var leaveBtn = document.getElementById('collabLeaveBtn');
  var simBtn = document.getElementById('collabSimulateBtn');
  var sendBtn = document.getElementById('collabChatSend');
  var chatInput = document.getElementById('collabChatInput');
  var profileInput = document.getElementById('collabProfileNameInput');

  if (profileInput) {
    profileInput.value = state.me.name;
    profileInput.addEventListener('change', function () {
      var clean = normalizeName(profileInput.value);
      if (clean) updateMeName(clean);
      renderSession();
    });
  }

  function ensureProfileName() {
    var proposed = profileInput ? profileInput.value : state.me.name;
    var clean = normalizeName(proposed);
    if (!clean) {
      setStatus('Enter profile name');
      return false;
    }
    updateMeName(clean);
    return true;
  }

  if (createBtn) {
    createBtn.onclick = async function () {
      if (!ensureProfileName()) return;
      var nameInput = document.getElementById('collabLobbyNameInput');
      var passInput = document.getElementById('collabLobbyPasswordInput');
      var codeInput = document.getElementById('collabLobbyCodeInput');
      await createLobby(
        nameInput ? nameInput.value : '',
        passInput ? passInput.value : '',
        codeInput ? codeInput.value : ''
      );
    };
  }

  if (joinBtn) {
    joinBtn.onclick = async function () {
      if (!ensureProfileName()) return;
      var passInput = document.getElementById('collabLobbyPasswordInput');
      var codeInput = document.getElementById('collabLobbyCodeInput');
      await joinLobby(
        codeInput ? codeInput.value : '',
        passInput ? passInput.value : ''
      );
    };
  }

  if (leaveBtn) leaveBtn.onclick = function () { leaveLobby(); };
  if (simBtn) simBtn.onclick = function () { simulate(); };

  function sendChat() {
    if (!chatInput) return;
    var text = chatInput.value.trim();
    if (!text) return;
    addChat(text, state.me.name);
    chatInput.value = '';
  }
  if (sendBtn) sendBtn.onclick = sendChat;
  if (chatInput) {
    chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendChat();
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
  createLobby: createLobby,
  joinLobby: joinLobby,
  leaveLobby: leaveLobby,
  refreshLobby: refreshLobby,
  addChat: addChat,
  upsertClipRange: upsertClipRange,
  getClipRanges: getClipRanges,
  getIndicatorAtTime: getIndicatorAtTime,
  getUserColor: getUserColor,
  subscribe: subscribe,
  simulate: simulate
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    bindUi();
    renderAll();
  });
} else {
  bindUi();
  renderAll();
}

// ── Lifecycle hooks ─────────────────────────────────────────────────
if (window._panelRegistry && window._panelRegistry.registerLifecycle) {
  window._panelRegistry.registerLifecycle('collabSession', {
    mount: function () { renderSession(); }
  });
  window._panelRegistry.registerLifecycle('collabChat', {
    mount: function () { renderChat(); },
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
  window._panelRegistry.registerLifecycle('collabActivity', {
    mount: function () { renderActivity(); }
  });
}

})();

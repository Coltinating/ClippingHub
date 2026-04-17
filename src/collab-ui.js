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
var utils = window.CollabUtils || null;

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
    name: normalizeName(prefs.meName || 'You'),
    xHandle: (window.Profile && window.Profile.sanitizeXHandle(prefs.meXHandle)) || '',
    color: (window.Profile && window.Profile.resolveUserColor({ color: prefs.meColor }, '')) || '',
    pfpDataUrl: (window.Profile && window.Profile.validatePfpDataUrl(prefs.mePfpDataUrl, 256000) ? prefs.mePfpDataUrl : '') || ''
  },
  assignment: {
    role: normalizeRole(prefs.role || 'clipper'),
    assistUserId: String(prefs.assistUserId || '').trim(),
    assistUserName: ''
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
      meXHandle: state.me.xHandle || '',
      meColor: state.me.color || '',
      mePfpDataUrl: state.me.pfpDataUrl || '',
      lastCode: state.lobby ? state.lobby.code : state.lastCode,
      role: state.assignment.role,
      assistUserId: state.assignment.assistUserId
    }));
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
  savePrefs();
  emit();
  if (state.lobby) refreshLobby();
}

function mePayload() {
  if (window.Profile && window.Profile.buildProfilePayload) return window.Profile.buildProfilePayload(state.me);
  return { id: state.me.id, name: state.me.name };
}

function findMemberById(memberId) {
  if (!memberId) return null;
  for (var i = 0; i < state.members.length; i++) {
    if (state.members[i].id === memberId) return state.members[i];
  }
  return null;
}

function syncAssistTarget() {
  if (!state.assignment.assistUserId) {
    state.assignment.assistUserName = '';
    return;
  }
  var match = findMemberById(state.assignment.assistUserId);
  if (!match || match.id === state.me.id) {
    state.assignment.assistUserId = '';
    state.assignment.assistUserName = '';
    return;
  }
  state.assignment.assistUserName = normalizeName(match.name || '');
}

function setRole(role) {
  state.assignment.role = normalizeRole(role);
  if (state.assignment.role !== 'helper') {
    state.assignment.assistUserId = '';
    state.assignment.assistUserName = '';
  } else {
    syncAssistTarget();
  }
  emit();
}

function setAssistUserId(userId) {
  state.assignment.assistUserId = String(userId || '').trim();
  syncAssistTarget();
  emit();
}

function getMarkContext() {
  var meName = normalizeName(state.me.name || 'You') || 'You';
  var meId = state.me.id;
  if (state.assignment.role !== 'helper') {
    return {
      userId: meId,
      userName: meName,
      clipperId: meId,
      clipperName: meName,
      helperId: null,
      helperName: ''
    };
  }
  syncAssistTarget();
  var assist = findMemberById(state.assignment.assistUserId);
  if (!assist) {
    return {
      userId: meId,
      userName: meName,
      clipperId: meId,
      clipperName: meName,
      helperId: null,
      helperName: ''
    };
  }
  var clipperName = normalizeName(assist.name || '') || 'Clipper';
  return {
    userId: meId,
    userName: meName,
    clipperId: assist.id,
    clipperName: clipperName,
    helperId: meId,
    helperName: meName
  };
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
  syncAssistTarget();
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
    user: mePayload()
  });
  if (!res || !res.success) {
    setStatus((res && res.error) ? res.error : 'Create failed');
    return null;
  }
  applyLobby(res.lobby);
  setStatus('Joined Lobby - code ' + state.lobby.code);
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
    user: mePayload()
  });
  if (!res || !res.success) {
    setStatus((res && res.error) ? res.error : 'Join failed');
    return null;
  }
  applyLobby(res.lobby);
  setStatus('Joined Lobby - code ' + state.lobby.code);
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
    user: mePayload()
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
    user: mePayload()
  });
  if (res && res.success) applyLobby(res.lobby);
  else if (res && res.error) setStatus(res.error);
  return res && res.success ? res.lobby : null;
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
    postThumbnailDataUrl: range.postThumbnailDataUrl || (existing && existing.postThumbnailDataUrl) || ''
  };

  var idx = -1;
  for (var i = 0; i < state.clipRanges.length; i++) {
    if (state.clipRanges[i].id === next.id) { idx = i; break; }
  }
  if (idx >= 0) {
    state.clipRanges[idx] = Object.assign({}, state.clipRanges[idx], next);
  } else {
    state.clipRanges.push(next);
  }
  emit();

  if (state.lobby && window.clipper && window.clipper.collabUpsertRange) {
    window.clipper.collabUpsertRange({
      code: state.lobby.code,
      range: next,
      user: mePayload()
    }).then(function (res) {
      if (res && res.success) applyLobby(res.lobby);
      else if (res && res.error) setStatus(res.error);
    });
  }
  return next;
}

function removeClipRange(rangeId) {
  var id = String(rangeId || '').trim();
  if (!id) return false;
  var before = state.clipRanges.length;
  state.clipRanges = state.clipRanges.filter(function (r) { return String(r.id || '') !== id; });
  if (before === state.clipRanges.length) return false;
  emit();
  if (state.lobby && window.clipper && window.clipper.collabRemoveRange) {
    window.clipper.collabRemoveRange({
      code: state.lobby.code,
      rangeId: id
    }).then(function (res) {
      if (res && res.success) applyLobby(res.lobby);
      else if (res && res.error) setStatus(res.error);
    });
  }
  return true;
}

function updateClipRangeCaption(rangeId, value) {
  var id = String(rangeId || '').trim();
  if (!id) return null;
  var existing = null;
  for (var i = 0; i < state.clipRanges.length; i++) {
    if (state.clipRanges[i].id === id) { existing = state.clipRanges[i]; break; }
  }
  if (!existing) return null;
  return upsertClipRange({
    id: id,
    inTime: existing.inTime,
    outTime: existing.outTime,
    postCaption: String(value == null ? '' : value),
    postCaptionUpdatedAt: Date.now()
  });
}

function updateClipRangeMetadata(rangeId, patch) {
  var id = String(rangeId || '').trim();
  if (!id || !patch) return null;
  var existing = null;
  for (var i = 0; i < state.clipRanges.length; i++) {
    if (state.clipRanges[i].id === id) { existing = state.clipRanges[i]; break; }
  }
  if (!existing) return null;
  var pick = {};
  ['fileName', 'filePath', 'displayPath', 'postThumbnailDataUrl', 'status'].forEach(function (k) {
    if (patch[k] != null) pick[k] = patch[k];
  });
  return upsertClipRange(Object.assign({
    id: id, inTime: existing.inTime, outTime: existing.outTime
  }, pick));
}

function getIndicatorAtTime(timeSec) {
  if (utils && utils.buildIndicatorAtTime) {
    return utils.buildIndicatorAtTime(state.clipRanges, timeSec);
  }
  if (!isFinite(timeSec)) return null;
  var names = [];
  for (var i = 0; i < state.clipRanges.length; i++) {
    var r = state.clipRanges[i];
    if (!r) continue;
    if (timeSec < r.inTime || timeSec > r.outTime) continue;
    var label = (r.clipperName || r.userName || 'Editor');
    if (r.helperName) label += ' (' + r.helperName + ')';
    if (names.indexOf(label) === -1) names.push(label);
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
  var roleInput = document.getElementById('collabRoleSelect');
  var assistInput = document.getElementById('collabAssistSelect');
  syncAssistTarget();
  if (status) {
    var roleText = state.assignment.role === 'helper'
      ? ('Helper' + (state.assignment.assistUserName ? ' -> ' + state.assignment.assistUserName : ''))
      : 'Clipper';
    if (statusText) status.textContent = statusText + ' - role ' + roleText;
    else if (state.lobby) status.textContent = state.lobby.name + ' - code ' + state.lobby.code + ' - role ' + roleText;
    else status.textContent = 'No active lobby - role ' + roleText;
  }
  if (profileInput && document.activeElement !== profileInput) {
    profileInput.value = state.me.name;
  }
  if (codeInput) {
    if (state.lobby && state.lobby.code) codeInput.value = state.lobby.code;
    else if (state.lastCode && !codeInput.value) codeInput.value = state.lastCode;
  }
  if (roleInput) roleInput.value = state.assignment.role;
  if (assistInput) {
    var html = ['<option value="">None</option>'];
    for (var i = 0; i < state.members.length; i++) {
      var member = state.members[i];
      if (!member || member.id === state.me.id) continue;
      var selected = member.id === state.assignment.assistUserId ? ' selected' : '';
      html.push('<option value="' + esc(member.id) + '"' + selected + '>' + esc(member.name) + '</option>');
    }
    assistInput.innerHTML = html.join('');
    assistInput.disabled = state.assignment.role !== 'helper';
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
      '<span><span class="collab-name" style="color:' + color + '">' + esc(label) + '</span> - ' + esc(verb) + '</span>' +
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
  if (editBtn) editBtn.addEventListener('click', openProfileModal);
  var closeBtn = document.getElementById('profileModalClose');
  if (closeBtn) closeBtn.addEventListener('click', closeProfileModal);
  var saveBtn = document.getElementById('profileSaveBtn');
  if (saveBtn) saveBtn.addEventListener('click', function () {
    var nameInput = document.getElementById('profileNameInput');
    var xInput = document.getElementById('profileXHandleInput');
    var colorInput = document.getElementById('profileColorInput');
    updateLocalProfile({
      name: nameInput ? nameInput.value : undefined,
      xHandle: xInput ? xInput.value : undefined,
      color: colorInput ? colorInput.value : undefined
    });
    closeProfileModal();
  });
  var pfpBtn = document.getElementById('profilePfpBtn');
  var pfpFile = document.getElementById('profilePfpFile');
  var pfpClear = document.getElementById('profilePfpClearBtn');
  if (pfpBtn && pfpFile) pfpBtn.addEventListener('click', function () { pfpFile.click(); });
  if (pfpFile) pfpFile.addEventListener('change', function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
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

function bindUi() {
  var createBtn = document.getElementById('collabCreateBtn');
  var joinBtn = document.getElementById('collabJoinBtn');
  var leaveBtn = document.getElementById('collabLeaveBtn');
  var simBtn = document.getElementById('collabSimulateBtn');
  var sendBtn = document.getElementById('collabChatSend');
  var chatInput = document.getElementById('collabChatInput');
  var profileInput = document.getElementById('collabProfileNameInput');
  var roleInput = document.getElementById('collabRoleSelect');
  var assistInput = document.getElementById('collabAssistSelect');
  var activityList = document.getElementById('collabActivityList');

  if (profileInput) {
    profileInput.value = state.me.name;
    profileInput.addEventListener('change', function () {
      var clean = normalizeName(profileInput.value);
      if (clean) updateMeName(clean);
      renderSession();
    });
  }
  if (roleInput) {
    roleInput.value = state.assignment.role;
    roleInput.addEventListener('change', function () {
      setRole(roleInput.value);
    });
  }
  if (assistInput) {
    assistInput.addEventListener('change', function () {
      setAssistUserId(assistInput.value || '');
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
  if (activityList) {
    activityList.addEventListener('click', function (e) {
      var btn = e.target.closest('.collab-time-link[data-time]');
      if (!btn) return;
      var time = Number(btn.getAttribute('data-time'));
      if (!isFinite(time)) return;
      if (window._panelBus && window._panelBus.emit) {
        window._panelBus.emit('collab:jump-to-time', { time: time });
      }
    });
  }
}

function setState(nextState) {
  state = {
    me: nextState.me || state.me,
    assignment: nextState.assignment || state.assignment,
    lobby: nextState.lobby || null,
    members: Array.isArray(nextState.members) ? nextState.members : [],
    chat: Array.isArray(nextState.chat) ? nextState.chat : [],
    clipRanges: Array.isArray(nextState.clipRanges) ? nextState.clipRanges : [],
    lastCode: nextState.lastCode || state.lastCode
  };
  state.assignment.role = normalizeRole(state.assignment.role);
  state.assignment.assistUserId = String(state.assignment.assistUserId || '').trim();
  syncAssistTarget();
  emit();
}

window.CollabUI = {
  getState: function () { return state; },
  setState: setState,
  updateLocalProfile: updateLocalProfile,
  mePayload: mePayload,
  createLobby: createLobby,
  joinLobby: joinLobby,
  leaveLobby: leaveLobby,
  refreshLobby: refreshLobby,
  addChat: addChat,
  upsertClipRange: upsertClipRange,
  removeClipRange: removeClipRange,
  getClipRanges: getClipRanges,
  getIndicatorAtTime: getIndicatorAtTime,
  getMarkContext: getMarkContext,
  setRole: setRole,
  setAssistUserId: setAssistUserId,
  getUserColor: getUserColor,
  subscribe: subscribe,
  simulate: simulate,
  updateClipRangeCaption: updateClipRangeCaption,
  updateClipRangeMetadata: updateClipRangeMetadata
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function () {
    bindUi();
    bindProfileUi();
    renderAll();
  });
} else {
  bindUi();
  bindProfileUi();
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

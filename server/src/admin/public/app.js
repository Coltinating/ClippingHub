/* eslint-env browser */
(function () {
'use strict';

// localStorage holds non-secret prefs and (when "remember" is checked) the
// admin token. sessionStorage always shadows it so an unticked session
// doesn't persist past tab close.
var STORAGE_KEY = 'ch_admin_v1';
var TOKEN_KEY = 'ch_admin_token_v1';

var ws = null;
var connected = false;
var lobbies = [];          // summaries from admin:list-lobbies
var selectedCode = null;
var lobbyDetails = {};     // code -> full snapshot from lobby:state
var joinedCode = null;     // currently ghost-joined lobby
var refreshTimer = null;
var currentView = 'lobbies'; // 'lobbies' | 'events'

// Auth state
var authedName = '';
var authedToken = '';
var rememberToken = false;

// Events view state
var EVENT_CAP = 5000;
var eventEntries = [];
var eventEnabled = new Set(['ws:in', 'ws:out', 'ws:broadcast', 'handler', 'ws:close', 'ws:error', 'other']);
var eventSearch = '';
var eventAutoscroll = true;

function $(id) { return document.getElementById(id); }
function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function escName(name) {
  var s = String(name || '');
  if (s.indexOf('[DEV] ') === 0) {
    return '<span class="dev-tag">[DEV]</span> ' + esc(s.slice(6));
  }
  return esc(s);
}

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch (_) { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (_) {}
}
function loadStoredToken() {
  // sessionStorage takes precedence — survives reload but not tab close.
  try {
    var s = sessionStorage.getItem(TOKEN_KEY);
    if (s) return { token: s, remembered: false };
    var l = localStorage.getItem(TOKEN_KEY);
    if (l) return { token: l, remembered: true };
  } catch (_) {}
  return { token: '', remembered: false };
}
function saveStoredToken(token, remember) {
  try {
    sessionStorage.setItem(TOKEN_KEY, token);
    if (remember) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
}
function clearStoredToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch (_) {}
}

var prefs = loadPrefs();

function getAdminUserId() {
  if (!prefs.adminId) {
    prefs.adminId = 'admin_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    savePrefs(prefs);
  }
  return prefs.adminId;
}

function setStatus(state, label) {
  var pill = $('connStatus');
  pill.dataset.state = state;
  pill.textContent = '● ' + (label || (state[0].toUpperCase() + state.slice(1)));
}

function wsUrl() {
  var loc = window.location;
  var proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  return proto + '//' + loc.host + '/ws';
}

// ── Sign-in flow ─────────────────────────────────────────
function showSignin(errMsg) {
  var overlay = $('signinOverlay');
  if (overlay) overlay.dataset.state = 'signin';
  if (overlay) overlay.hidden = false;
  document.body.classList.add('signin-active');
  var err = $('signinError');
  if (err) {
    if (errMsg) { err.textContent = errMsg; err.hidden = false; }
    else { err.textContent = ''; err.hidden = true; }
  }
  $('topbarIdentity').hidden = true;
  $('signoutBtn').hidden = true;
  // Pre-fill from prefs / storage on first show.
  var nameInput = $('signinName');
  var tokenInput = $('signinToken');
  var rememberInput = $('signinRemember');
  if (nameInput && !nameInput.value) nameInput.value = prefs.adminName || '';
  var stored = loadStoredToken();
  if (tokenInput && !tokenInput.value && stored.token) tokenInput.value = stored.token;
  if (rememberInput) rememberInput.checked = !!stored.remembered;
  // Focus the empty field.
  setTimeout(function () {
    if (nameInput && !nameInput.value) nameInput.focus();
    else if (tokenInput && !tokenInput.value) tokenInput.focus();
  }, 50);
}

function hideSignin() {
  var overlay = $('signinOverlay');
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('signin-active');
}

function setSubmitBusy(busy) {
  var btn = $('signinSubmit');
  var lbl = $('signinSubmitLabel');
  if (!btn) return;
  btn.disabled = !!busy;
  if (lbl) lbl.textContent = busy ? 'Signing in…' : 'Sign in';
}

function attemptSignin(e) {
  if (e && e.preventDefault) e.preventDefault();
  var name = $('signinName').value.trim();
  var token = $('signinToken').value.trim();
  var remember = $('signinRemember').checked;
  if (!name) { showSignin('Display name required.'); return; }
  if (!token) { showSignin('Admin token required.'); return; }
  authedName = name;
  authedToken = token;
  rememberToken = remember;
  prefs.adminName = name;
  savePrefs(prefs);
  setSubmitBusy(true);
  var hideErr = $('signinError'); if (hideErr) hideErr.hidden = true;
  connect();
}

function signOut(opts) {
  var keepError = opts && opts.keepError;
  authedName = '';
  authedToken = '';
  // Always clear stored token on explicit sign-out / auth rejection. The
  // "remember" preference only governs auto-fill on the next sign-in.
  clearStoredToken();
  // Wipe the token field so a stale value can't be re-submitted; keep the
  // name pre-filled because that's a convenience, not a credential.
  var tokenInput = $('signinToken');
  if (tokenInput) tokenInput.value = '';
  if (ws) { try { ws.close(); } catch (_) {} ws = null; }
  connected = false;
  joinedCode = null;
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  setStatus('offline');
  $('topbarIdentity').hidden = true;
  $('signoutBtn').hidden = true;
  showSignin(keepError || '');
}

// ── Connection ──────────────────────────────────────────
function connect() {
  if (connected || ws) return;
  setStatus('connecting');
  var sock;
  try { sock = new WebSocket(wsUrl()); }
  catch (err) {
    setSubmitBusy(false);
    showSignin('Could not open WebSocket.');
    return;
  }
  ws = sock;
  sock.onopen = function () {
    sock.send(JSON.stringify({
      type: 'hello',
      user: { id: getAdminUserId(), name: authedName },
      admin: { name: authedName, token: authedToken }
    }));
  };
  sock.onmessage = function (ev) {
    var m;
    try { m = JSON.parse(ev.data); } catch (_) { return; }
    handleMsg(m);
  };
  sock.onclose = function () {
    var wasConnected = connected;
    connected = false;
    ws = null;
    setStatus('offline');
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
    setSubmitBusy(false);
    // If we never authed in the first place, fall back to sign-in screen.
    if (!wasConnected && !authedToken) showSignin();
    else if (!wasConnected) {
      // Connection dropped before hello:ack — likely server restart or rate-kill.
      showSignin('Connection closed before sign-in completed.');
    } else {
      // Was authed and got disconnected — show sign-in for re-auth.
      $('topbarIdentity').hidden = true;
      $('signoutBtn').hidden = true;
      showSignin('Connection lost.');
    }
  };
  sock.onerror = function () {
    setStatus('offline');
    setSubmitBusy(false);
  };
}

function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function handleMsg(m) {
  switch (m.type) {
    case 'hello:ack':
      if (m.authTried && !m.isAdmin) {
        // Token was sent but server rejected it.
        try { ws.close(); } catch (_) {}
        ws = null;
        setSubmitBusy(false);
        signOut({ keepError: 'Admin token rejected. Check the value in your server .env or console.' });
        return;
      }
      if (!m.isAdmin) {
        // Should never happen — we always send a token. Be safe.
        try { ws.close(); } catch (_) {}
        ws = null;
        setSubmitBusy(false);
        signOut({ keepError: 'Server did not grant admin access.' });
        return;
      }
      // Authed.
      saveStoredToken(authedToken, rememberToken);
      connected = true;
      setSubmitBusy(false);
      hideSignin();
      setStatus('online');
      var idLabel = $('topbarIdName');
      if (idLabel) idLabel.textContent = '[DEV] ' + authedName;
      $('topbarIdentity').hidden = false;
      $('signoutBtn').hidden = false;
      send({ type: 'admin:list-lobbies' });
      send({ type: 'admin:subscribe-events' });
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(function () { send({ type: 'admin:list-lobbies' }); }, 3000);
      break;
    case 'admin:event':
      if (m.event) addEvent(m.event);
      break;
    case 'admin:event-batch':
      if (Array.isArray(m.events)) for (var i = 0; i < m.events.length; i++) addEvent(m.events[i]);
      break;
    case 'admin:lobbies':
      lobbies = m.lobbies || [];
      renderLobbyList();
      break;
    case 'lobby:state':
      lobbyDetails[m.lobby.code] = m.lobby;
      if (m.lobby.code === selectedCode || m.lobby.code === joinedCode) renderDetail();
      break;
    case 'member:joined':
    case 'member:updated':
      if (joinedCode && lobbyDetails[joinedCode]) {
        var ld = lobbyDetails[joinedCode];
        var idx = ld.members.findIndex(function (x) { return x.id === m.member.id; });
        if (idx >= 0) ld.members[idx] = m.member;
        else ld.members.push(m.member);
        renderDetail();
      }
      break;
    case 'member:left':
      if (joinedCode && lobbyDetails[joinedCode]) {
        var ld2 = lobbyDetails[joinedCode];
        ld2.members = ld2.members.filter(function (x) { return x.id !== m.memberId; });
        renderDetail();
      }
      break;
    case 'chat:message':
      var targetCode = joinedCode || selectedCode;
      if (targetCode && lobbyDetails[targetCode]) {
        lobbyDetails[targetCode].chat.push(m.message);
        renderDetail();
      }
      break;
    case 'admin:ack':
      break;
    case 'error':
      if (m.code === 'forbidden') {
        // Mid-session privilege loss (shouldn't happen, but be defensive).
        signOut({ keepError: 'Server denied an admin operation. Token may have changed.' });
        return;
      }
      console.warn('server error', m.code, m.message);
      break;
  }
}

function renderLobbyList() {
  var ul = $('lobbyList');
  if (!lobbies.length) {
    ul.innerHTML = '<li class="lobby-empty">No lobbies yet.</li>';
    return;
  }
  ul.innerHTML = lobbies.map(function (l) {
    var active = (l.code === selectedCode) ? ' active' : '';
    var joined = (l.code === joinedCode) ? ' <span class="admin-badge">JOINED</span>' : '';
    return '<li class="lobby-item' + active + '" data-code="' + esc(l.code) + '">' +
      '<div class="lobby-item-row">' +
        '<span class="lobby-item-name">' + esc(l.name) + '</span>' + joined +
        '<span class="lobby-item-code">' + esc(l.code) + '</span>' +
      '</div>' +
      '<div class="lobby-item-meta">' + l.memberCount + ' members · ' + l.chatCount + ' msgs · ' + l.rangeCount + ' ranges</div>' +
    '</li>';
  }).join('');
}

function renderDetail() {
  var d = lobbyDetails[selectedCode];
  if (!selectedCode || !d) {
    $('detailEmpty').hidden = false;
    $('detailContent').hidden = true;
    return;
  }
  $('detailEmpty').hidden = true;
  $('detailContent').hidden = false;
  $('lobbyName').textContent = d.name || 'Lobby';
  $('lobbyCode').textContent = d.code;
  $('lobbyMembersText').textContent = (d.members.length) + ' members';
  $('lobbyChatText').textContent = (d.chat.length) + ' messages';
  $('lobbyRangesText').textContent = (d.clipRanges ? d.clipRanges.length : 0) + ' ranges';

  var isJoined = joinedCode === selectedCode;
  $('joinBtn').hidden = isJoined;
  $('leaveBtn').hidden = !isJoined;

  // Members
  var ml = $('memberList');
  if (!d.members.length) {
    ml.innerHTML = '<li class="muted">No members.</li>';
  } else {
    ml.innerHTML = d.members.map(function (m) {
      var role = (m.role || 'viewer').toLowerCase();
      var adminBadge = m.isAdmin ? ' <span class="admin-badge">ADMIN</span>' : '';
      return '<li class="member-row">' +
        '<span class="member-name">' + escName(m.name) + '</span>' +
        '<span class="member-role-badge ' + esc(role) + '">' + esc(role) + '</span>' +
        adminBadge +
      '</li>';
    }).join('');
  }

  // Chat
  var cl = $('chatList');
  if (!d.chat.length) {
    cl.innerHTML = '<div class="chat-empty">No messages yet.</div>';
  } else {
    cl.innerHTML = d.chat.slice(-200).map(function (msg) {
      return '<div class="chat-row"><b class="author">' + escName(msg.userName) + ':</b> ' + esc(msg.text) + '</div>';
    }).join('');
    cl.scrollTop = cl.scrollHeight;
  }

  // Ranges
  var rl = $('rangeList');
  var ranges = d.clipRanges || [];
  if (!ranges.length) {
    rl.innerHTML = '<li class="muted">No ranges.</li>';
  } else {
    rl.innerHTML = ranges.slice(0, 50).map(function (r) {
      return '<li class="range-row"><span>' + esc(r.id) + '</span> ' +
        '<span class="muted">' + (Number(r.inTime) || 0).toFixed(1) + ' → ' + (Number(r.outTime) || 0).toFixed(1) + 's</span> ' +
        '<span class="muted">by ' + escName(r.clipperName || r.userName || '') + '</span>' +
      '</li>';
    }).join('');
  }
}

function selectLobby(code) {
  selectedCode = code;
  if (!lobbyDetails[code]) {
    var summary = lobbies.find(function (l) { return l.code === code; });
    if (summary) {
      lobbyDetails[code] = {
        code: summary.code,
        name: summary.name,
        members: [],
        chat: [],
        clipRanges: []
      };
    }
  }
  renderLobbyList();
  renderDetail();
}

function joinSelected() {
  if (!selectedCode) return;
  send({ type: 'lobby:join', code: selectedCode, password: '' });
  joinedCode = selectedCode;
  setTimeout(renderLobbyList, 50);
}

function leaveJoined() {
  if (!joinedCode) return;
  send({ type: 'lobby:leave' });
  joinedCode = null;
  setTimeout(function () { renderLobbyList(); renderDetail(); }, 50);
}

function deleteSelected() {
  if (!selectedCode) return;
  var d = lobbyDetails[selectedCode];
  var label = (d && d.name) ? d.name + ' (' + selectedCode + ')' : selectedCode;
  if (!confirm('Delete lobby "' + label + '"?\n\nThis kicks every member and cannot be undone.')) return;
  var code = selectedCode;
  send({ type: 'admin:delete-lobby', code: code });
  if (joinedCode === code) joinedCode = null;
  delete lobbyDetails[code];
  selectedCode = null;
  lobbies = lobbies.filter(function (l) { return l.code !== code; });
  renderLobbyList();
  renderDetail();
  send({ type: 'admin:list-lobbies' });
}

function sendChat() {
  var text = $('chatInput').value.trim();
  if (!text || !selectedCode) return;
  if (joinedCode === selectedCode) {
    send({ type: 'chat:send', text: text });
  } else {
    send({ type: 'admin:send-chat', code: selectedCode, text: text });
  }
  $('chatInput').value = '';
}

// ── Events view ──────────────────────────────────────────
function bucketOf(evt) {
  var e = String(evt && evt.evt || '');
  if (e === 'ws:in') return 'ws:in';
  if (e === 'ws:out') return 'ws:out';
  if (e === 'ws:broadcast') return 'ws:broadcast';
  if (e === 'ws:close') return 'ws:close';
  if (e === 'ws:error') return 'ws:error';
  if (e.indexOf('handler') === 0) return 'handler';
  return 'other';
}

function addEvent(evt) {
  if (!evt || typeof evt !== 'object') return;
  evt._bucket = bucketOf(evt);
  eventEntries.push(evt);
  if (eventEntries.length > EVENT_CAP) eventEntries.shift();
  if (currentView === 'events') {
    renderEventsAppend(evt);
    updateEventsCount();
  }
}

function eventLineText(e) {
  var time = new Date(e.ts || Date.now()).toISOString().slice(11, 23);
  var lvl = (e.level || 'info').toUpperCase();
  var name = e.evt || e.message || '';
  var skip = { ts: 1, level: 1, evt: 1, message: 1, _bucket: 1 };
  var parts = [];
  for (var k in e) {
    if (skip[k]) continue;
    if (e[k] === undefined || e[k] === null) continue;
    parts.push(k + '=' + (typeof e[k] === 'object' ? JSON.stringify(e[k]) : e[k]));
  }
  return '[' + time + '] ' + lvl + ' ' + name + (parts.length ? ' · ' + parts.join(' ') : '');
}

function eventPasses(e) {
  if (!eventEnabled.has(e._bucket)) return false;
  if (eventSearch) {
    var hay = eventLineText(e).toLowerCase();
    if (hay.indexOf(eventSearch) < 0) return false;
  }
  return true;
}

function renderEventsAppend(e) {
  var list = $('eventsList');
  if (!list) return;
  if (!eventPasses(e)) return;
  var div = document.createElement('div');
  div.className = 'event-line bucket-' + e._bucket + (e.level === 'warn' || e.level === 'error' ? ' warn' : '');
  div.textContent = eventLineText(e);
  list.appendChild(div);
  if (eventAutoscroll) list.scrollTop = list.scrollHeight;
}

function rerenderEvents() {
  var list = $('eventsList');
  if (!list) return;
  list.innerHTML = '';
  for (var i = 0; i < eventEntries.length; i++) renderEventsAppend(eventEntries[i]);
  updateEventsCount();
}

function updateEventsCount() {
  var el = $('eventsCount');
  if (el) el.textContent = eventEntries.length + ' events';
}

function showView(name) {
  currentView = name;
  document.querySelectorAll('.topnav-tab').forEach(function (t) {
    t.classList.toggle('active', t.dataset.view === name);
  });
  document.querySelectorAll('[data-view]').forEach(function (el) {
    if (el.classList.contains('topnav-tab')) return;
    el.hidden = (el.dataset.view !== name);
  });
  if (name === 'events') rerenderEvents();
}

function bindEventsUi() {
  document.querySelectorAll('.topnav-tab').forEach(function (tab) {
    tab.addEventListener('click', function () { showView(tab.dataset.view); });
  });
  var filters = $('eventsFilters');
  if (filters) {
    filters.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-evt]');
      if (!btn) return;
      var k = btn.dataset.evt;
      if (eventEnabled.has(k)) { eventEnabled.delete(k); btn.classList.remove('active'); }
      else { eventEnabled.add(k); btn.classList.add('active'); }
      rerenderEvents();
    });
  }
  var search = $('eventsSearch');
  if (search) {
    search.addEventListener('input', function () {
      eventSearch = search.value.trim().toLowerCase();
      rerenderEvents();
    });
  }
  var auto = $('eventsAutoscroll');
  if (auto) auto.addEventListener('change', function () { eventAutoscroll = !!auto.checked; });
  var clearBtn = $('eventsClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', function () {
    eventEntries.length = 0;
    var list = $('eventsList');
    if (list) list.innerHTML = '';
    updateEventsCount();
  });
}

function bindUi() {
  $('signinForm').addEventListener('submit', attemptSignin);
  $('signinTokenToggle').addEventListener('click', function () {
    var input = $('signinToken');
    var btn = $('signinTokenToggle');
    if (!input || !btn) return;
    var visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    btn.textContent = visible ? 'show' : 'hide';
  });
  $('signoutBtn').addEventListener('click', function () { signOut(); });
  $('refreshBtn').addEventListener('click', function () { send({ type: 'admin:list-lobbies' }); });
  $('lobbyList').addEventListener('click', function (e) {
    var item = e.target.closest('[data-code]');
    if (item) selectLobby(item.dataset.code);
  });
  $('joinBtn').addEventListener('click', joinSelected);
  $('leaveBtn').addEventListener('click', leaveJoined);
  $('deleteBtn').addEventListener('click', deleteSelected);
  $('chatSendBtn').addEventListener('click', sendChat);
  $('chatInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') sendChat();
  });
  document.querySelectorAll('.tab[data-tab]').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t === tab); });
      document.querySelectorAll('.tab-panel[data-tab-panel]').forEach(function (p) {
        p.hidden = p.dataset.tabPanel !== tab.dataset.tab;
      });
    });
  });
}

function bootstrap() {
  bindUi();
  bindEventsUi();
  // Try silent auto-sign-in if a token is remembered.
  var stored = loadStoredToken();
  if (stored.token && prefs.adminName) {
    authedName = prefs.adminName;
    authedToken = stored.token;
    rememberToken = stored.remembered;
    setSubmitBusy(true); // show busy state in case sign-in screen flashes
    showSignin();
    // Brief tick so the overlay paints, then attempt connect.
    setTimeout(connect, 0);
  } else {
    showSignin();
  }
}

bootstrap();

})();

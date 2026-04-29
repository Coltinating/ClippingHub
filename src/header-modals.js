'use strict';

/* ─────────────────────────────────────────────────────────────
   Header modals + config import/export.
   Wired from Edit menu (Config) and Help menu (About, Shortcuts).
   ───────────────────────────────────────────────────────────── */
(function () {
  function _toast(msg) {
    if (typeof window.toast === 'function') window.toast(msg);
    else console.log('[header-modals]', msg);
  }

  function exportAppConfig() {
    if (!window.clipper || !window.clipper.exportAppConfig) {
      _toast('Export not available');
      return;
    }
    window.clipper.exportAppConfig().then(function (res) {
      if (res && res.success) _toast('Config exported to ' + res.path);
      else if (res && res.canceled) { /* user cancelled */ }
      else _toast('Export failed');
    }).catch(function (err) { _toast('Export failed: ' + (err && err.message || err)); });
  }

  function importAppConfig() {
    if (!window.clipper || !window.clipper.importAppConfig) {
      _toast('Import not available');
      return;
    }
    window.clipper.importAppConfig().then(function (res) {
      if (res && res.success) {
        _toast('Config imported. Reloading…');
        setTimeout(function () { location.reload(); }, 700);
      } else if (res && res.canceled) { /* user cancelled */ }
      else _toast('Import failed: ' + ((res && res.error) || 'unknown'));
    }).catch(function (err) { _toast('Import failed: ' + (err && err.message || err)); });
  }

  function _showModal(m) {
    if (!m) return;
    m.hidden = false;
    m.removeAttribute('hidden');
    m.classList.add('open');
  }
  function _hideModal(m) {
    if (!m) return;
    m.classList.remove('open');
    m.hidden = true;
  }

  function openAbout() {
    var m = document.getElementById('aboutModal'); if (!m) return;
    var v = document.getElementById('aboutVersion');
    if (v && window.clipper && window.clipper.getAppVersion) {
      window.clipper.getAppVersion().then(function (ver) { v.textContent = ver || ''; })
        .catch(function () { v.textContent = ''; });
    }
    _showModal(m);
  }

  // ─── Keyboard Shortcuts editor ─────────────────────────────
  // Working copy of the user's keybinds. Mutated as the user edits;
  // committed to userConfig + persisted on Save, discarded on Cancel.
  var _draft = null;
  var _capturingId = null; // id of the binding currently being captured
  var _activeTab = 'Seeking'; // sidebar selection — defaults to most-used category

  // Sidebar metadata (icons + subtitles match the settings menu visual language)
  var TAB_META = {
    'Seeking':  { icon: '⏱', subtitle: 'Time-jump bindings and step sizes' },
    'Clipping': { icon: '✂', subtitle: 'Mark and edit IN/OUT for new clips' },
    'Playback': { icon: '▶', subtitle: 'Play, volume, speed, fullscreen' },
    'Layout':   { icon: '◫', subtitle: 'Reset and save panel layouts' },
    'Header':   { icon: '⌘', subtitle: 'Optional header shortcuts (unbound by default)' },
  };

  function _liveKb() {
    return (window.userConfig && window.userConfig.keybinds) || {};
  }

  function _bindingRowHtml(def, conflictSet) {
    var Reg = window.KeybindRegistry;
    var bind = _draft[def.id] || '';
    var formatted = Reg.formatBinding(bind);
    var capturing = (_capturingId === def.id);
    var conflict = conflictSet[def.id];
    var btnLabel = capturing ? 'Press a key…' : (bind ? formatted : 'Set shortcut');
    return '<div class="kb-row' + (conflict ? ' kb-conflict' : '') + (capturing ? ' kb-capturing' : '') + '">' +
              '<div class="kb-row-label">' +
                '<div class="kb-row-name">' + _esc(def.label) + '</div>' +
                (def.description ? '<div class="kb-row-desc">' + _esc(def.description) + '</div>' : '') +
              '</div>' +
              '<div class="kb-row-actions">' +
                '<button class="kb-bind-btn' + (capturing ? ' capturing' : '') + (bind ? '' : ' unbound') + '" data-action="capture" data-id="' + _esc(def.id) + '">' +
                  _esc(btnLabel) +
                '</button>' +
                '<button class="kb-clear-btn" data-action="clear" data-id="' + _esc(def.id) + '" title="Clear">&times;</button>' +
                '<button class="kb-reset-btn" data-action="reset" data-id="' + _esc(def.id) + '" title="Reset to default (' + _esc(Reg.formatBinding(def.default)) + ')">↺</button>' +
              '</div>' +
            '</div>';
  }

  function _jumpSizesHtml() {
    var Reg = window.KeybindRegistry;
    var html = '<div class="kb-subhead">Jump Sizes (seconds)</div>';
    Reg.JUMP_SIZES.forEach(function (def) {
      var v = _draft[def.id];
      if (v == null) v = def.default;
      html += '<div class="kb-row">' +
                '<div class="kb-row-label"><div class="kb-row-name">' + _esc(def.label) + '</div></div>' +
                '<div class="kb-row-actions">' +
                  '<input type="number" class="kb-num-input" data-id="' + _esc(def.id) + '" value="' + Number(v) + '" min="' + def.min + '" max="' + def.max + '">' +
                '</div>' +
              '</div>';
    });
    return html;
  }

  function _renderSidebar(groups) {
    var sidebar = document.getElementById('shortcutsSidebar');
    if (!sidebar) return;
    var html = '<div class="shortcuts-sidebar-title">Shortcuts</div>';
    groups.forEach(function (g) {
      var meta = TAB_META[g.name] || { icon: '·', subtitle: '' };
      var active = (g.name === _activeTab) ? ' active' : '';
      html += '<div class="shortcuts-tab' + active + '" data-tab="' + _esc(g.name) + '">' +
                '<span class="shortcuts-tab-icon">' + meta.icon + '</span>' +
                '<span class="shortcuts-tab-label">' + _esc(g.name) + '</span>' +
              '</div>';
    });
    sidebar.innerHTML = html;
  }

  function _renderShortcuts() {
    var body = document.getElementById('shortcutsBody');
    var Reg = window.KeybindRegistry;
    if (!body || !Reg) return;
    var groups = Reg.groupedRegistry();
    var searchEl = document.getElementById('shortcutsSearch');
    var query = (searchEl && searchEl.value || '').trim().toLowerCase();
    var conflicts = Reg.findConflicts(_draft);
    var conflictSet = {};
    conflicts.forEach(function (c) { c.ids.forEach(function (id) { conflictSet[id] = c.binding; }); });

    // If active tab no longer exists (shouldn't happen, but safe), fall back to first
    if (!groups.some(function (g) { return g.name === _activeTab; })) {
      _activeTab = groups[0] ? groups[0].name : 'Seeking';
    }

    _renderSidebar(groups);

    var titleEl = document.getElementById('shortcutsPaneTitle');
    var subEl   = document.getElementById('shortcutsPaneSubtitle');

    var html = '';
    if (query) {
      // Flat search results across every category
      if (titleEl) titleEl.textContent = 'Search';
      if (subEl)   subEl.textContent   = 'Showing matches for "' + query + '"';
      groups.forEach(function (group) {
        var rows = group.items.filter(function (def) {
          var hay = (def.label + ' ' + def.id + ' ' + (def.description || '') + ' ' + (_draft[def.id] || '')).toLowerCase();
          return hay.indexOf(query) !== -1;
        });
        if (rows.length === 0) return;
        html += '<div class="kb-subhead">' + _esc(group.name) + '</div>';
        rows.forEach(function (def) { html += _bindingRowHtml(def, conflictSet); });
      });
      if ('jump sizes seconds seek'.indexOf(query) !== -1 || 'seeking'.indexOf(query) !== -1) {
        html += _jumpSizesHtml();
      }
      if (!html) html = '<div class="kb-empty">No shortcuts match "' + _esc(query) + '"</div>';
    } else {
      // Single-category pane (matches Settings menu sidebar+pane pattern)
      var meta = TAB_META[_activeTab] || { subtitle: '' };
      if (titleEl) titleEl.textContent = _activeTab;
      if (subEl)   subEl.textContent   = meta.subtitle;
      var group = groups.find(function (g) { return g.name === _activeTab; });
      if (group) {
        group.items.forEach(function (def) { html += _bindingRowHtml(def, conflictSet); });
      }
      // Jump-size inputs live in the Seeking pane — they belong with the time-jump bindings
      if (_activeTab === 'Seeking') html += _jumpSizesHtml();
    }

    body.innerHTML = html;

    // Status line: conflict summary
    var status = document.getElementById('shortcutsStatus');
    if (status) {
      if (conflicts.length === 0) {
        status.textContent = '';
        status.classList.remove('has-conflict');
      } else {
        status.textContent = conflicts.length + ' conflict' + (conflicts.length === 1 ? '' : 's') + ' — actions sharing the same key cannot both fire.';
        status.classList.add('has-conflict');
      }
    }
  }

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function _onShortcutsBodyClick(e) {
    var target = e.target.closest('button');
    if (!target) return;
    var id = target.getAttribute('data-id');
    var action = target.getAttribute('data-action');
    if (!id || !action) return;
    e.stopPropagation();
    var Reg = window.KeybindRegistry;
    if (!Reg) return;
    if (action === 'capture') {
      _capturingId = (_capturingId === id) ? null : id;
      _renderShortcuts();
    } else if (action === 'clear') {
      _draft[id] = '';
      _capturingId = null;
      _renderShortcuts();
    } else if (action === 'reset') {
      var def = Reg.REGISTRY.find(function (d) { return d.id === id; });
      if (def) _draft[id] = def.default;
      _capturingId = null;
      _renderShortcuts();
    }
  }

  function _onShortcutsBodyChange(e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('kb-num-input')) {
      var id = t.getAttribute('data-id');
      var n = parseInt(t.value, 10);
      if (!isNaN(n)) _draft[id] = n;
    }
  }

  // Capture a key press while a row is in capture mode
  function _onShortcutsKeydown(e) {
    var modal = document.getElementById('shortcutsModal');
    if (!modal || !modal.classList.contains('open')) return;
    if (!_capturingId) return;
    if (e.key === 'Escape') {
      _capturingId = null;
      e.preventDefault(); e.stopPropagation();
      _renderShortcuts();
      return;
    }
    var Reg = window.KeybindRegistry;
    if (!Reg) return;
    var bind = Reg.eventToBinding(e);
    if (!bind) return; // pure modifier press, ignore
    e.preventDefault(); e.stopPropagation();
    _draft[_capturingId] = bind;
    _capturingId = null;
    _renderShortcuts();
  }

  function _resetAllShortcuts() {
    var Reg = window.KeybindRegistry;
    if (!Reg) return;
    Reg.REGISTRY.forEach(function (d) { _draft[d.id] = d.default; });
    Reg.JUMP_SIZES.forEach(function (d) { _draft[d.id] = d.default; });
    _capturingId = null;
    _renderShortcuts();
  }

  function _saveShortcuts() {
    if (!window.userConfig) window.userConfig = {};
    if (!window.userConfig.keybinds) window.userConfig.keybinds = {};
    var kb = window.userConfig.keybinds;
    var Reg = window.KeybindRegistry;
    if (!Reg) return;
    Reg.REGISTRY.forEach(function (d) { kb[d.id] = _draft[d.id] || ''; });
    Reg.JUMP_SIZES.forEach(function (d) { kb[d.id] = Number(_draft[d.id]) || d.default; });
    if (window.clipper && window.clipper.saveUserConfig) {
      window.clipper.saveUserConfig(window.userConfig).catch(function () {});
    }
    _hideModal(document.getElementById('shortcutsModal'));
    _toast('Keyboard shortcuts saved');
  }

  function openShortcuts() {
    var Reg = window.KeybindRegistry;
    if (!Reg) { _toast('Shortcut registry not loaded'); return; }
    // Snapshot the live keybinds into a working draft
    var live = _liveKb();
    _draft = {};
    Reg.REGISTRY.forEach(function (d) { _draft[d.id] = (live[d.id] != null) ? live[d.id] : d.default; });
    Reg.JUMP_SIZES.forEach(function (d) { _draft[d.id] = (live[d.id] != null) ? live[d.id] : d.default; });
    _capturingId = null;
    _activeTab = 'Seeking'; // most-used category opens first
    var searchEl = document.getElementById('shortcutsSearch');
    if (searchEl) searchEl.value = '';
    _renderShortcuts();
    _showModal(document.getElementById('shortcutsModal'));
  }

  function closeModal(id) {
    _hideModal(document.getElementById(id));
  }

  // ESC closes any open modal
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    ['shortcutsModal', 'aboutModal'].forEach(function (id) {
      var m = document.getElementById(id);
      if (m && m.classList.contains('open')) _hideModal(m);
    });
  });

  // Click on overlay (outside modal box) closes
  document.addEventListener('click', function (e) {
    if (!e.target.classList || !e.target.classList.contains('modal-overlay')) return;
    if (e.target.id !== 'aboutModal' && e.target.id !== 'shortcutsModal') return;
    _hideModal(e.target);
  });

  // Wire shortcuts editor interactions once the DOM is ready
  function _wireShortcutsEditor() {
    var body = document.getElementById('shortcutsBody');
    if (body) {
      body.addEventListener('click', _onShortcutsBodyClick);
      body.addEventListener('change', _onShortcutsBodyChange);
      body.addEventListener('input', _onShortcutsBodyChange);
    }
    var sidebar = document.getElementById('shortcutsSidebar');
    if (sidebar) {
      sidebar.addEventListener('click', function (e) {
        var tab = e.target.closest('.shortcuts-tab');
        if (!tab) return;
        _activeTab = tab.getAttribute('data-tab') || 'Seeking';
        var search = document.getElementById('shortcutsSearch');
        if (search) search.value = '';
        _capturingId = null;
        _renderShortcuts();
      });
    }
    var search = document.getElementById('shortcutsSearch');
    if (search) search.addEventListener('input', _renderShortcuts);
    var resetAll = document.getElementById('shortcutsResetAll');
    if (resetAll) resetAll.addEventListener('click', _resetAllShortcuts);
    var save = document.getElementById('shortcutsSave');
    if (save) save.addEventListener('click', _saveShortcuts);
    var cancel = document.getElementById('shortcutsCancel');
    if (cancel) cancel.addEventListener('click', function () { _hideModal(document.getElementById('shortcutsModal')); });
    var close = document.getElementById('shortcutsClose');
    if (close) close.addEventListener('click', function () { _hideModal(document.getElementById('shortcutsModal')); });
    document.addEventListener('keydown', _onShortcutsKeydown, true /* capture before app handlers */);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wireShortcutsEditor);
  } else {
    _wireShortcutsEditor();
  }

  window.HeaderModals = {
    exportAppConfig: exportAppConfig,
    importAppConfig: importAppConfig,
    openAbout: openAbout,
    openShortcuts: openShortcuts,
    closeModal: closeModal,
  };
})();

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

  function openAbout() {
    var m = document.getElementById('aboutModal'); if (!m) return;
    var v = document.getElementById('aboutVersion');
    if (v && window.clipper && window.clipper.getAppVersion) {
      window.clipper.getAppVersion().then(function (ver) { v.textContent = ver || ''; })
        .catch(function () { v.textContent = ''; });
    }
    m.hidden = false;
  }

  function openShortcuts() {
    var m = document.getElementById('shortcutsModal'); if (m) m.hidden = false;
  }

  function closeModal(id) {
    var m = document.getElementById(id); if (m) m.hidden = true;
  }

  // ESC closes the topmost open modal
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    ['shortcutsModal', 'aboutModal'].forEach(function (id) {
      var m = document.getElementById(id);
      if (m && !m.hidden) m.hidden = true;
    });
  });

  // Click on overlay (outside modal box) closes
  document.addEventListener('click', function (e) {
    if (!e.target.classList || !e.target.classList.contains('modal-overlay')) return;
    e.target.hidden = true;
  });

  window.HeaderModals = {
    exportAppConfig: exportAppConfig,
    importAppConfig: importAppConfig,
    openAbout: openAbout,
    openShortcuts: openShortcuts,
    closeModal: closeModal,
  };
})();

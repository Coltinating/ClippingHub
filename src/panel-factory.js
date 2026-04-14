(function () {
'use strict';

// ── Panel Factory ───────────────────────────────────────────────────
// Create panels entirely from JS — no HTML editing required.
//
// Usage:
//   window._panelFactory.createPanel({
//     type: 'myPanel',
//     body: function(container) { container.innerHTML = '...'; },
//     lifecycle: { mount, unmount, saveState, restoreState }
//   });

function createPanel(opts) {
  if (!opts || !opts.type) {
    console.error('[panelFactory] createPanel requires opts.type');
    return null;
  }

  var reg = window._panelRegistry;
  var type = opts.type;

  // Validate the type is registered
  if (!reg || !reg.isPanelType || !reg.isPanelType(type)) {
    console.error('[panelFactory] Panel type "' + type + '" not found in registry. Register it first.');
    return null;
  }

  var info = reg.getPanelInfo(type);
  if (!info || !info.elId) {
    console.error('[panelFactory] Panel type "' + type + '" has no elId (multi-instance panels use a different path).');
    return null;
  }

  // Check if element already exists (avoid duplicates)
  var existing = document.getElementById(info.elId);
  if (existing) return existing;

  // Build panel DOM
  var panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = info.elId;

  var body = document.createElement('div');
  body.className = 'panel-body';

  // Let the caller populate the body
  if (typeof opts.body === 'function') {
    opts.body(body);
  }

  panel.appendChild(body);

  // Append to staging area
  var staging = document.getElementById('panelStaging');
  if (staging) {
    staging.appendChild(panel);
  }

  // Register lifecycle hooks if provided
  if (opts.lifecycle && reg.registerLifecycle) {
    reg.registerLifecycle(type, opts.lifecycle);
  }

  return panel;
}

// ── Public API ──────────────────────────────────────────────────────

var api = {
  createPanel: createPanel
};

if (typeof window !== 'undefined') window._panelFactory = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();

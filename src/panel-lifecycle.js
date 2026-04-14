(function () {
'use strict';

// ── State ───────────────────────────────────────────────────────────

var STORAGE_KEY = 'ch_panel_states';
var _initialized = {};   // panelType|instanceKey → true (tracks whether init has fired)
var _mountedIn = {};      // panelType|instanceKey → leafId|floatId (tracks current mount location)
var _panelStates = {};    // panelType|instanceKey → saved state object

// Restore persisted states on load
try {
  var raw = localStorage.getItem(STORAGE_KEY);
  if (raw) _panelStates = JSON.parse(raw);
} catch (e) { /* ignore corrupt data */ }

// ── Helpers ─────────────────────────────────────────────────────────

function _getLifecycle(panelType) {
  var reg = window._panelRegistry;
  if (!reg || !reg.getPanelInfo) return null;
  var info = reg.getPanelInfo(panelType);
  return (info && info.lifecycle) ? info.lifecycle : null;
}

function _stateKey(panelType, leafId, floatId) {
  var reg = window._panelRegistry;
  var isMulti = reg && reg.isMultiInstance && reg.isMultiInstance(panelType);
  if (isMulti) {
    if (floatId) return 'float:' + floatId;
    if (leafId) return 'leaf:' + leafId;
  }
  return panelType;
}

function _buildContext(panelType, element, leafId, floatId) {
  return {
    panelType: panelType,
    leafId: leafId || null,
    floatId: floatId || null,
    element: element,
    isFloating: !!floatId
  };
}

function _persistStates() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_panelStates));
  } catch (e) { /* storage full — degrade silently */ }
}

// ── Lifecycle Notifications ─────────────────────────────────────────

function notifyMount(panelType, element, leafId, floatId) {
  if (!panelType || panelType === 'empty') return;
  var lc = _getLifecycle(panelType);
  if (!lc) return;

  var key = _stateKey(panelType, leafId, floatId);
  var location = floatId || leafId;

  // Skip redundant mount if panel hasn't moved
  if (_mountedIn[key] === location) return;
  _mountedIn[key] = location;

  var ctx = _buildContext(panelType, element, leafId, floatId);

  // First-ever mount → call init
  if (!_initialized[key] && typeof lc.init === 'function') {
    lc.init(ctx);
    _initialized[key] = true;
  }

  // Restore state before mount
  if (_panelStates[key] && typeof lc.restoreState === 'function') {
    lc.restoreState(_panelStates[key]);
  }

  // Mount hook
  if (typeof lc.mount === 'function') {
    lc.mount(ctx);
  }
}

function notifyUnmount(panelType, element) {
  if (!panelType || panelType === 'empty') return;
  var lc = _getLifecycle(panelType);
  if (!lc) return;

  // Determine key — for shared panels, just the type
  var key = panelType;
  var ctx = _buildContext(panelType, element, null, null);

  // Save state before unmount
  if (typeof lc.saveState === 'function') {
    var state = lc.saveState();
    if (state !== undefined && state !== null) {
      _panelStates[key] = state;
      _persistStates();
    }
  }

  // Unmount hook
  if (typeof lc.unmount === 'function') {
    lc.unmount(ctx);
  }

  delete _mountedIn[key];
}

function notifyDestroy(instanceKey) {
  if (!instanceKey) return;
  // instanceKey is like 'leaf:a_xxx' or 'float:f_xxx'
  // We need the panelType — for now, multi-instance = viewer
  var lc = _getLifecycle('viewer');
  if (lc && typeof lc.destroy === 'function') {
    lc.destroy({ panelType: 'viewer', instanceKey: instanceKey });
  }
  delete _initialized[instanceKey];
  delete _mountedIn[instanceKey];
  delete _panelStates[instanceKey];
  _persistStates();
}

// ── Public API ──────────────────────────────────────────────────────

function getState(panelType) {
  return _panelStates[panelType] || null;
}

function setState(panelType, state) {
  _panelStates[panelType] = state;
  _persistStates();
}

function clearState(panelType) {
  delete _panelStates[panelType];
  _persistStates();
}

var api = {
  notifyMount: notifyMount,
  notifyUnmount: notifyUnmount,
  notifyDestroy: notifyDestroy,
  getState: getState,
  setState: setState,
  clearState: clearState
};

if (typeof window !== 'undefined') window._panelLifecycle = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();

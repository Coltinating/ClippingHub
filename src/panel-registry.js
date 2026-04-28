(function () {
'use strict';

var PANEL_DEFINITIONS = {
  clipper: {
    key: 'clipper',
    group: 'players',
    title: 'Clipper',
    menuLabel: 'Clipper',
    emptyLabel: 'Clipper',
    viewCheckId: 'chk-clipper',
    elId: 'panel-preview',
    icon: '<svg viewBox="0 0 12 12" fill="currentColor"><polygon points="3,1 10,6 3,11"/></svg>',
    multiInstance: false,
    lifecycle: null
  },
  viewer: {
    key: 'viewer',
    group: 'players',
    title: 'Viewer',
    menuLabel: 'Viewer',
    emptyLabel: 'Viewer',
    viewCheckId: 'chk-viewer',
    elId: null,
    icon: '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="2" width="10" height="7" rx="1"/><rect x="4" y="10" width="4" height="1" rx="0.5"/></svg>',
    multiInstance: true,
    lifecycle: null
  },
  media: {
    key: 'media',
    group: 'core',
    title: 'Media Sources',
    menuLabel: 'Media Sources',
    emptyLabel: 'Source',
    viewCheckId: 'chk-media',
    elId: 'panel-media',
    icon: '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M2 1h8a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1zm0 2v6h8V3H2z"/></svg>',
    multiInstance: false,
    lifecycle: null
  },
  timeline: {
    key: 'timeline',
    group: 'core',
    title: 'Timeline',
    menuLabel: 'Timeline',
    emptyLabel: 'Timeline',
    viewCheckId: 'chk-timeline',
    elId: 'panel-timeline',
    icon: '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="0" y="3" width="12" height="2"/><rect x="0" y="7" width="12" height="2"/><rect x="4" y="0" width="1" height="12"/></svg>',
    multiInstance: false,
    lifecycle: null
  },
  clips: {
    key: 'clips',
    group: 'core',
    title: 'Clips Queue',
    menuLabel: 'Clips Queue',
    emptyLabel: 'Clips',
    viewCheckId: 'chk-clips',
    elId: 'hubSection',
    icon: '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="3" rx="0.5"/><rect x="1" y="5" width="10" height="3" rx="0.5"/><rect x="1" y="9" width="7" height="2" rx="0.5"/></svg>',
    multiInstance: false,
    lifecycle: null
  },
  collab: {
    key: 'collab',
    group: 'collab',
    title: 'Collab',
    menuLabel: 'Collab',
    emptyLabel: 'Collab',
    viewCheckId: 'chk-collab',
    elId: 'panel-collab',
    icon: '<svg viewBox="0 0 12 12" fill="currentColor"><circle cx="4" cy="4" r="2"/><circle cx="8.5" cy="4.5" r="1.5"/><path d="M1.5 10c0-2 1.8-3 3.5-3s3.5 1 3.5 3v1h-7z"/><path d="M7.3 11v-1c0-1.2.9-1.9 2.1-1.9s2.1.7 2.1 1.9v1z"/></svg>',
    multiInstance: false,
    lifecycle: null
  },
  preview: {
    key: 'preview',
    aliasFor: 'clipper',
    group: 'players',
    title: 'Clipper',
    menuLabel: 'Clipper',
    emptyLabel: 'Clipper',
    viewCheckId: 'chk-clipper',
    elId: 'panel-preview',
    icon: '<svg viewBox="0 0 12 12" fill="currentColor"><polygon points="3,1 10,6 3,11"/></svg>',
    multiInstance: false,
    hidden: true,
    lifecycle: null
  }
};

var GROUP_META = {
  players: { key: 'players', label: 'Players' },
  core: { key: 'core', label: 'Core Panels' },
  collab: { key: 'collab', label: 'Collaboration' }
};

function normalizePanelType(panelType) {
  if (panelType === 'preview') return 'clipper';
  return panelType;
}

function getPanelTypes() {
  var keys = Object.keys(PANEL_DEFINITIONS);
  var out = [];
  for (var i = 0; i < keys.length; i++) {
    var def = PANEL_DEFINITIONS[keys[i]];
    if (def && !def.hidden) out.push(def.key);
  }
  return out;
}

function getPanelInfo(panelType) {
  var normalized = normalizePanelType(panelType);
  return PANEL_DEFINITIONS[normalized] || null;
}

function isPanelType(panelType) {
  return !!getPanelInfo(panelType);
}

function isMultiInstance(panelType) {
  var info = getPanelInfo(panelType);
  return !!(info && info.multiInstance);
}

function getPanelOptionGroups() {
  var grouped = {};
  var types = getPanelTypes();
  for (var i = 0; i < types.length; i++) {
    var type = types[i];
    var def = PANEL_DEFINITIONS[type];
    if (!grouped[def.group]) grouped[def.group] = [];
    grouped[def.group].push({
      type: def.key,
      label: def.emptyLabel || def.title
    });
  }

  var out = [];
  var order = ['players', 'core', 'collab'];
  for (var j = 0; j < order.length; j++) {
    var key = order[j];
    if (!grouped[key]) continue;
    out.push({
      key: key,
      label: GROUP_META[key] ? GROUP_META[key].label : key,
      options: grouped[key]
    });
  }
  return out;
}

function registerLifecycle(panelType, hooks) {
  var normalized = normalizePanelType(panelType);
  var def = PANEL_DEFINITIONS[normalized];
  if (!def) return;
  def.lifecycle = hooks;
}

var api = {
  PANEL_DEFINITIONS: PANEL_DEFINITIONS,
  getPanelTypes: getPanelTypes,
  getPanelInfo: getPanelInfo,
  isPanelType: isPanelType,
  isMultiInstance: isMultiInstance,
  normalizePanelType: normalizePanelType,
  getPanelOptionGroups: getPanelOptionGroups,
  registerLifecycle: registerLifecycle
};

if (typeof window !== 'undefined') window._panelRegistry = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();

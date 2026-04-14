(function () {
'use strict';

var ST = null;
var PANEL_INFO = (window._panelRegistry && window._panelRegistry.PANEL_DEFINITIONS) || {};
var viewerInstances = {};

function normalizePanelType(panelType) {
  if (window._panelRegistry && window._panelRegistry.normalizePanelType) {
    return window._panelRegistry.normalizePanelType(panelType);
  }
  if (panelType === 'preview') return 'clipper';
  return panelType;
}

function getPanelTitle(panelType) {
  var info = window._panelRegistry && window._panelRegistry.getPanelInfo
    ? window._panelRegistry.getPanelInfo(panelType)
    : null;
  return info && info.title ? info.title : panelType;
}

function getSharedPanelElement(panelType) {
  var info = window._panelRegistry && window._panelRegistry.getPanelInfo
    ? window._panelRegistry.getPanelInfo(panelType)
    : PANEL_INFO[panelType];
  if (!info || !info.elId) return null;
  return document.getElementById(info.elId) || null;
}

function createPanelSelect(currentType) {
  var select = document.createElement('select');
  select.className = 'area-panel-select';
  select.innerHTML = '<option value="empty">Empty</option>';

  var groups = window._panelRegistry ? window._panelRegistry.getPanelOptionGroups() : [];
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i];
    var optGroup = document.createElement('optgroup');
    optGroup.label = group.label;
    for (var j = 0; j < group.options.length; j++) {
      var opt = document.createElement('option');
      opt.value = group.options[j].type;
      opt.textContent = group.options[j].label;
      optGroup.appendChild(opt);
    }
    select.appendChild(optGroup);
  }
  select.value = normalizePanelType(currentType || 'empty');
  return select;
}

function buildEmptyAreaPicker() {
  var picker = document.createElement('div');
  picker.className = 'empty-panel-picker';

  var label = document.createElement('label');
  label.className = 'empty-panel-picker-label';
  label.textContent = 'Panel';
  picker.appendChild(label);

  var select = document.createElement('select');
  select.className = 'empty-panel-select';
  select.innerHTML = '<option value="">Select panel...</option>';

  var groups = window._panelRegistry ? window._panelRegistry.getPanelOptionGroups() : [];
  for (var i = 0; i < groups.length; i++) {
    var group = groups[i];
    var optGroup = document.createElement('optgroup');
    optGroup.label = group.label;
    for (var j = 0; j < group.options.length; j++) {
      var def = group.options[j];
      var option = document.createElement('option');
      option.value = def.type;
      option.textContent = def.label;
      optGroup.appendChild(option);
    }
    select.appendChild(optGroup);
  }

  picker.appendChild(select);
  return picker;
}

function createAreaHeader(leaf) {
  var panelType = normalizePanelType(leaf.panelType);
  var info = window._panelRegistry && window._panelRegistry.getPanelInfo
    ? window._panelRegistry.getPanelInfo(panelType)
    : PANEL_INFO[panelType];

  var header = document.createElement('div');
  header.className = 'area-header';
  header.dataset.leafId = leaf.id;

  var icon = document.createElement('span');
  icon.className = 'area-icon';
  icon.innerHTML = info ? info.icon : '';
  header.appendChild(icon);

  var title = document.createElement('span');
  title.className = 'area-title';
  title.textContent = panelType === 'empty' ? 'Empty' : (info ? info.title : 'Panel');
  header.appendChild(title);

  if (panelType !== 'empty') {
    header.appendChild(createPanelSelect(panelType));
  }

  var actions = document.createElement('div');
  actions.className = 'area-actions';

  if (panelType !== 'empty') {
    var undockBtn = document.createElement('button');
    undockBtn.className = 'area-btn undock';
    undockBtn.title = 'Undock panel';
    undockBtn.innerHTML = '<svg viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.1" fill="none"><rect x="2" y="3" width="8" height="6" rx="0.8"/><path d="M4 1.5h4"/></svg>';
    actions.appendChild(undockBtn);
  }

  var closeBtn = document.createElement('button');
  closeBtn.className = 'area-btn close';
  closeBtn.title = 'Close area';
  closeBtn.innerHTML = '<svg viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M2 2l6 6M8 2l-6 6"/></svg>';
  actions.appendChild(closeBtn);

  header.appendChild(actions);
  return header;
}

function addCornerHandles(areaEl) {
  var corners = ['tl', 'tr', 'bl', 'br'];
  for (var i = 0; i < corners.length; i++) {
    var handle = document.createElement('div');
    handle.className = 'corner-hotzone corner-' + corners[i];
    handle.dataset.corner = corners[i];
    areaEl.appendChild(handle);
  }
}

function destroyViewerInstance(key) {
  if (window._panelLifecycle) window._panelLifecycle.notifyDestroy(key);
  if (window._viewerPlayer) {
    window._viewerPlayer.destroy(key);
  }
  delete viewerInstances[key];
}

function createViewerPanel(instanceKey) {
  if (window._viewerPlayer) {
    var inst = window._viewerPlayer.create(instanceKey);
    viewerInstances[instanceKey] = inst;
    window._viewerPlayer.autoFollow(inst);
    return inst.el;
  }
  var el = document.createElement('div');
  el.className = 'panel viewer-panel';
  el.textContent = 'Viewer module not loaded';
  return el;
}

function getViewerPanel(instanceKey) {
  if (viewerInstances[instanceKey]) return viewerInstances[instanceKey].el;
  return createViewerPanel(instanceKey);
}

function getLeafPanelElement(leaf) {
  var panelType = normalizePanelType(leaf.panelType);
  if (panelType === 'viewer') {
    return getViewerPanel('leaf:' + leaf.id);
  }
  return getSharedPanelElement(panelType);
}

function buildNode(node, parentRatio, isSecondChild) {
  if (node.type === 'leaf') return buildLeaf(node, parentRatio, isSecondChild);
  return buildBranch(node, parentRatio, isSecondChild);
}

function buildLeaf(leaf, parentRatio, isSecondChild) {
  var panelType = normalizePanelType(leaf.panelType);
  var el = document.createElement('div');
  el.className = 'split-area';
  el.dataset.nodeId = leaf.id;
  el.dataset.panelType = panelType;

  if (parentRatio !== undefined) {
    var weight = isSecondChild ? (1 - parentRatio) : parentRatio;
    el.style.flex = weight + ' ' + weight + ' 0%';
  } else {
    el.style.flex = '1';
  }

  el.appendChild(createAreaHeader(leaf));

  var content = document.createElement('div');
  content.className = 'area-content';

  if (panelType !== 'empty') {
    var panelEl = getLeafPanelElement(leaf);
    if (panelEl) {
      panelEl.style.display = '';
      content.appendChild(panelEl);
      if (window._panelLifecycle) window._panelLifecycle.notifyMount(panelType, panelEl, leaf.id, null);
    }
  } else {
    var empty = document.createElement('div');
    empty.className = 'area-empty';
    empty.appendChild(buildEmptyAreaPicker());

    var emptyIcon = document.createElement('div');
    emptyIcon.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" opacity="0.3"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>';
    empty.appendChild(emptyIcon.firstChild);

    var emptyText = document.createElement('p');
    emptyText.textContent = 'Empty area';
    empty.appendChild(emptyText);
    content.appendChild(empty);
  }

  el.appendChild(content);
  addCornerHandles(el);
  return el;
}

function buildBranch(branch, parentRatio, isSecondChild) {
  var el = document.createElement('div');
  el.className = 'split-container ' + (branch.direction === 'horizontal' ? 'split-h' : 'split-v');
  el.dataset.nodeId = branch.id;

  if (parentRatio !== undefined) {
    var weight = isSecondChild ? (1 - parentRatio) : parentRatio;
    el.style.flex = weight + ' ' + weight + ' 0%';
  } else {
    el.style.flex = '1';
  }

  el.appendChild(buildNode(branch.children[0], branch.ratio, false));
  var divider = document.createElement('div');
  divider.className = 'split-divider ' + (branch.direction === 'horizontal' ? 'split-divider-h' : 'split-divider-v');
  divider.dataset.branchId = branch.id;
  el.appendChild(divider);
  el.appendChild(buildNode(branch.children[1], branch.ratio, true));
  return el;
}

function stashAllPanels() {
  var staging = document.getElementById('panelStaging');
  if (!staging) return;

  var types = window._panelRegistry && window._panelRegistry.getPanelTypes
    ? window._panelRegistry.getPanelTypes()
    : Object.keys(PANEL_INFO);

  for (var i = 0; i < types.length; i++) {
    var panelType = normalizePanelType(types[i]);
    if (panelType === 'viewer') continue;
    var el = getSharedPanelElement(panelType);
    if (el && el.parentElement !== staging) {
      if (window._panelLifecycle) window._panelLifecycle.notifyUnmount(panelType, el);
      staging.appendChild(el);
    }
  }
}

function cleanupViewerInstances(activeKeys) {
  var keys = Object.keys(viewerInstances);
  for (var i = 0; i < keys.length; i++) {
    if (activeKeys.indexOf(keys[i]) !== -1) continue;
    destroyViewerInstance(keys[i]);
  }
}

// Floating panels are now real Electron BrowserWindows (managed via IPC in panels.js).
// renderFloatingPanels is kept as a no-op so callers don't break.
function renderFloatingPanels() {}

function render() {
  if (!ST) return;
  var dockRoot = document.getElementById('dockRoot');
  if (!dockRoot) return;

  stashAllPanels();
  dockRoot.innerHTML = '';

  var root = ST.getRoot();
  if (root) {
    var dom = buildNode(root, undefined, false);
    if (dom) dockRoot.appendChild(dom);
  }

  var activeViewerKeys = [];
  var leaves = ST.getAllLeaves();
  for (var i = 0; i < leaves.length; i++) {
    if (normalizePanelType(leaves[i].panelType) === 'viewer') {
      activeViewerKeys.push('leaf:' + leaves[i].id);
    }
  }
  renderFloatingPanels(activeViewerKeys);
  cleanupViewerInstances(activeViewerKeys);

  if (window._panelBus) window._panelBus.emit('layout:changed', {});
}

function updateRatios() {
  if (!ST) return;
  var root = ST.getRoot();
  if (!root || root.type !== 'branch') return;
  updateBranchRatios(root);
}

function updateBranchRatios(branch) {
  var container = document.querySelector('[data-node-id="' + branch.id + '"]');
  if (!container) return;

  applyRatiosToChildren(container, branch);
  for (var i = 0; i < 2; i++) {
    if (branch.children[i].type === 'branch') updateBranchRatios(branch.children[i]);
  }
}

function applyRatiosToChildren(containerEl, branch) {
  var children = containerEl.children;
  var firstChild = null;
  var secondChild = null;
  var idx = 0;
  for (var i = 0; i < children.length; i++) {
    if (children[i].classList.contains('split-divider')) continue;
    if (idx === 0) { firstChild = children[i]; idx++; continue; }
    if (idx === 1) { secondChild = children[i]; idx++; }
  }
  if (firstChild) firstChild.style.flex = branch.ratio + ' ' + branch.ratio + ' 0%';
  if (secondChild) {
    var r2 = 1 - branch.ratio;
    secondChild.style.flex = r2 + ' ' + r2 + ' 0%';
  }
}

function getAreaBody(leafId) {
  var el = document.querySelector('.split-area[data-node-id="' + leafId + '"]');
  if (!el) return null;
  return el.querySelector('.area-content');
}

function init() {
  ST = window._splitTree;
  if (!ST) {
    console.warn('[split-layout] window._splitTree not found');
    return;
  }
  render();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── Viewer lifecycle ────────────────────────────────────────────────
if (window._panelRegistry && window._panelRegistry.registerLifecycle) {
  window._panelRegistry.registerLifecycle('viewer', {
    mount: function (ctx) {
      if (window._viewerPlayer && ctx.leafId) {
        var inst = window._viewerPlayer.get('leaf:' + ctx.leafId);
        if (inst) window._viewerPlayer.autoFollow(inst);
      }
    },
    destroy: function (ctx) {
      if (ctx && ctx.instanceKey) destroyViewerInstance(ctx.instanceKey);
    }
  });
}

window._splitLayout = {
  render: render,
  updateRatios: updateRatios,
  getAreaBody: getAreaBody,
  stashAllPanels: stashAllPanels,
  getPanelElement: getSharedPanelElement,
  PANEL_INFO: PANEL_INFO
};

})();

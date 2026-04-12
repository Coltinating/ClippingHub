(function () {
'use strict';

var ST = null; // reference to window._splitTree, set on init

// ── Panel Registry ─────────────────────────────────────────────
// Maps panelType to { elId, title, icon }

var PANEL_INFO = {
  media:    { elId: 'panel-media',    title: 'Media Sources', icon: '<svg viewBox="0 0 12 12" fill="currentColor"><path d="M2 1h8a1 1 0 011 1v8a1 1 0 01-1 1H2a1 1 0 01-1-1V2a1 1 0 011-1zm0 2v6h8V3H2z"/></svg>' },
  preview:  { elId: 'panel-preview',  title: 'Preview',       icon: '<svg viewBox="0 0 12 12" fill="currentColor"><polygon points="3,1 10,6 3,11"/></svg>' },
  timeline: { elId: 'panel-timeline', title: 'Timeline',      icon: '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="0" y="3" width="12" height="2"/><rect x="0" y="7" width="12" height="2"/><rect x="4" y="0" width="1" height="12"/></svg>' },
  clips:    { elId: 'hubSection',     title: 'Clips Queue',   icon: '<svg viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="1" width="10" height="3" rx="0.5"/><rect x="1" y="5" width="10" height="3" rx="0.5"/><rect x="1" y="9" width="7" height="2" rx="0.5"/></svg>' }
};

// Retrieve a panel element by panel type
function getPanelElement(panelType) {
  var info = PANEL_INFO[panelType];
  if (!info) return null;
  return document.getElementById(info.elId) || null;
}

// ── Area Header Creation ───────────────────────────────────────

function createAreaHeader(panelType) {
  var info = PANEL_INFO[panelType];
  var header = document.createElement('div');
  header.className = 'area-header';

  var icon = document.createElement('span');
  icon.className = 'area-icon';
  icon.innerHTML = info ? info.icon : '';
  header.appendChild(icon);

  var title = document.createElement('span');
  title.className = 'area-title';
  title.textContent = info ? info.title : 'Empty';
  header.appendChild(title);

  var actions = document.createElement('div');
  actions.className = 'area-actions';

  var closeBtn = document.createElement('button');
  closeBtn.className = 'area-btn close';
  closeBtn.title = 'Close area';
  closeBtn.innerHTML = '<svg viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M2 2l6 6M8 2l-6 6"/></svg>';
  actions.appendChild(closeBtn);

  header.appendChild(actions);
  return header;
}

// ── Corner Handles ─────────────────────────────────────────────

function addCornerHandles(areaEl) {
  var corners = ['tl', 'tr', 'bl', 'br'];
  for (var i = 0; i < corners.length; i++) {
    var handle = document.createElement('div');
    handle.className = 'corner-hotzone corner-' + corners[i];
    handle.dataset.corner = corners[i];
    areaEl.appendChild(handle);
  }
}

// ── Recursive DOM Builder ──────────────────────────────────────

function buildNode(node, parentRatio, isSecondChild) {
  if (node.type === 'leaf') {
    return buildLeaf(node, parentRatio, isSecondChild);
  } else {
    return buildBranch(node, parentRatio, isSecondChild);
  }
}

function buildLeaf(leaf, parentRatio, isSecondChild) {
  var el = document.createElement('div');
  el.className = 'split-area';
  el.dataset.nodeId = leaf.id;
  el.dataset.panelType = leaf.panelType;

  // Flex sizing: use the ratio weight from the parent branch
  if (parentRatio !== undefined) {
    var weight = isSecondChild ? (1 - parentRatio) : parentRatio;
    el.style.flex = weight + ' ' + weight + ' 0%';
  } else {
    // Root is a single leaf — fill everything
    el.style.flex = '1';
  }

  // Area header
  el.appendChild(createAreaHeader(leaf.panelType));

  // Area content
  var content = document.createElement('div');
  content.className = 'area-content';

  if (leaf.panelType !== 'empty') {
    var panelEl = getPanelElement(leaf.panelType);
    if (panelEl) {
      // Move the panel element from staging into this area
      panelEl.style.display = '';
      content.appendChild(panelEl);
    }
  } else {
    var empty = document.createElement('div');
    empty.className = 'area-empty';
    empty.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" opacity="0.3"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg><p>Empty area</p>';
    content.appendChild(empty);
  }

  el.appendChild(content);

  // Corner handles for split/join
  addCornerHandles(el);

  return el;
}

function buildBranch(branch, parentRatio, isSecondChild) {
  var el = document.createElement('div');
  el.className = 'split-container ' + (branch.direction === 'horizontal' ? 'split-h' : 'split-v');
  el.dataset.nodeId = branch.id;

  // Flex sizing based on parent's ratio
  if (parentRatio !== undefined) {
    var weight = isSecondChild ? (1 - parentRatio) : parentRatio;
    el.style.flex = weight + ' ' + weight + ' 0%';
  } else {
    // Root branch fills everything
    el.style.flex = '1';
  }

  // First child
  el.appendChild(buildNode(branch.children[0], branch.ratio, false));

  // Divider
  var divider = document.createElement('div');
  divider.className = 'split-divider ' + (branch.direction === 'horizontal' ? 'split-divider-h' : 'split-divider-v');
  divider.dataset.branchId = branch.id;
  el.appendChild(divider);

  // Second child
  el.appendChild(buildNode(branch.children[1], branch.ratio, true));

  return el;
}

// ── Full Render ────────────────────────────────────────────────

function render() {
  if (!ST) return;
  var dockRoot = document.getElementById('dockRoot');
  if (!dockRoot) return;

  // Stash all panel elements back to staging first (preserve DOM state)
  stashAllPanels();

  // Clear dockRoot
  dockRoot.innerHTML = '';

  // Build from tree
  var root = ST.getRoot();
  if (!root) return;

  var dom = buildNode(root, undefined, false);
  if (dom) {
    dockRoot.appendChild(dom);
  }
}

function stashAllPanels() {
  var staging = document.getElementById('panelStaging');
  if (!staging) return;

  // Move all known panel elements back to staging
  for (var type in PANEL_INFO) {
    if (!PANEL_INFO.hasOwnProperty(type)) continue;
    var el = getPanelElement(type);
    if (el && el.parentElement !== staging) {
      staging.appendChild(el);
    }
  }
}

// ── Ratio Update (no rebuild, just flex changes) ───────────────

function updateRatios() {
  if (!ST) return;
  var root = ST.getRoot();
  if (!root || root.type !== 'branch') return;

  _updateBranchRatios(root);
}

function _updateBranchRatios(branch) {
  var container = document.querySelector('[data-node-id="' + branch.id + '"]');
  if (!container) return;

  _applyRatiosToChildren(container, branch);

  // Recurse into child branches
  for (var i = 0; i < 2; i++) {
    if (branch.children[i].type === 'branch') {
      _updateBranchRatios(branch.children[i]);
    }
  }
}

function _applyRatiosToChildren(containerEl, branch) {
  var children = containerEl.children;
  var firstChild = null;
  var secondChild = null;
  var idx = 0;

  for (var i = 0; i < children.length; i++) {
    if (!children[i].classList.contains('split-divider')) {
      if (idx === 0) { firstChild = children[i]; idx++; }
      else if (idx === 1) { secondChild = children[i]; idx++; }
    }
  }

  if (firstChild) {
    firstChild.style.flex = branch.ratio + ' ' + branch.ratio + ' 0%';
  }
  if (secondChild) {
    var r2 = 1 - branch.ratio;
    secondChild.style.flex = r2 + ' ' + r2 + ' 0%';
  }
}

// ── Get Area Body (for external mounting) ──────────────────────

function getAreaBody(leafId) {
  var el = document.querySelector('.split-area[data-node-id="' + leafId + '"]');
  if (el) return el.querySelector('.area-content');
  return null;
}

// ── Init ───────────────────────────────────────────────────────

function init() {
  ST = window._splitTree;
  if (!ST) {
    console.warn('[split-layout] window._splitTree not found');
    return;
  }
  render();
}

// Run init when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ── Expose API ─────────────────────────────────────────────────

window._splitLayout = {
  render: render,
  updateRatios: updateRatios,
  getAreaBody: getAreaBody,
  stashAllPanels: stashAllPanels,
  getPanelElement: getPanelElement,
  PANEL_INFO: PANEL_INFO
};

})();

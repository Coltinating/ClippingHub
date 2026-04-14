(function () {
'use strict';

var openMenu = null;
var floatingPanels = [];
var floatCounter = 0;

function normalizePanelType(panelType) {
  if (window._panelRegistry && window._panelRegistry.normalizePanelType) {
    return window._panelRegistry.normalizePanelType(panelType);
  }
  if (panelType === 'preview') return 'clipper';
  return panelType;
}

function isKnownPanelType(panelType) {
  return !!(window._panelRegistry && window._panelRegistry.isPanelType && window._panelRegistry.isPanelType(panelType));
}

function isMultiInstance(panelType) {
  var normalized = normalizePanelType(panelType);
  if (window._panelRegistry && window._panelRegistry.isMultiInstance) {
    return window._panelRegistry.isMultiInstance(normalized);
  }
  return false;
}

function getAllPanelTypes() {
  if (window._panelRegistry && window._panelRegistry.getPanelTypes) {
    return window._panelRegistry.getPanelTypes();
  }
  return ['clipper', 'viewer', 'media', 'timeline', 'clips'];
}

function getViewCheckId(panelType) {
  if (window._panelRegistry && window._panelRegistry.getPanelInfo) {
    var info = window._panelRegistry.getPanelInfo(panelType);
    if (info && info.viewCheckId) return info.viewCheckId;
  }
  return 'chk-' + panelType;
}

function getFirstLeafByPanelType(panelType) {
  var ST = window._splitTree;
  if (!ST) return null;
  var normalized = normalizePanelType(panelType);
  var leaves = ST.getAllLeaves();
  for (var i = 0; i < leaves.length; i++) {
    if (normalizePanelType(leaves[i].panelType) === normalized) return leaves[i];
  }
  return null;
}

function getLeavesByPanelType(panelType) {
  var ST = window._splitTree;
  if (!ST) return [];
  var normalized = normalizePanelType(panelType);
  var leaves = ST.getAllLeaves();
  var out = [];
  for (var i = 0; i < leaves.length; i++) {
    if (normalizePanelType(leaves[i].panelType) === normalized) out.push(leaves[i]);
  }
  return out;
}

function hasOpenPanelType(panelType) {
  var normalized = normalizePanelType(panelType);
  if (getLeavesByPanelType(normalized).length > 0) return true;
  for (var i = 0; i < floatingPanels.length; i++) {
    if (normalizePanelType(floatingPanels[i].panelType) === normalized) return true;
  }
  return false;
}

document.querySelectorAll('.menu-item[data-menu]').forEach(function (item) {
  item.addEventListener('click', function (e) {
    e.stopPropagation();
    var dd = document.getElementById('menu-' + item.dataset.menu);
    if (dd === openMenu) { closeAllMenus(); return; }
    closeAllMenus();
    dd.classList.add('open');
    openMenu = dd;
  });
  item.addEventListener('mouseenter', function () {
    if (!openMenu) return;
    var dd = document.getElementById('menu-' + item.dataset.menu);
    if (dd !== openMenu) {
      closeAllMenus();
      dd.classList.add('open');
      openMenu = dd;
    }
  });
});

window.closeAllMenus = function () {
  document.querySelectorAll('.dropdown').forEach(function (d) { d.classList.remove('open'); });
  openMenu = null;
  if (window._splitInteract) window._splitInteract.hideContextMenu();
};
document.addEventListener('click', closeAllMenus);

function closeLeafById(leafId, opts) {
  opts = opts || {};
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return false;

  var leaf = ST.findNode(leafId);
  if (!leaf || leaf.type !== 'leaf') return false;

  var sibling = ST.findSibling(leaf.id);
  if (sibling) {
    if (sibling.type === 'leaf') {
      ST.joinAreas(sibling.id, leaf.id);
    } else {
      leaf.panelType = 'empty';
    }
  } else {
    leaf.panelType = 'empty';
  }

  SL.render();
  updateViewChecks();
  if (!opts.silent) {
    toast('Area closed');
  }
  if (!opts.noSave) autoSaveLayout();
  return true;
}

function closePanel(name) {
  var panelType = normalizePanelType(name);
  var leaf = getFirstLeafByPanelType(panelType);
  if (leaf) {
    closeLeafById(leaf.id);
    return;
  }
  for (var i = 0; i < floatingPanels.length; i++) {
    if (normalizePanelType(floatingPanels[i].panelType) !== panelType) continue;
    closeFloating(floatingPanels[i].id);
    return;
  }
}

function placePanelType(panelType) {
  var ST = window._splitTree;
  if (!ST) return false;

  var leaves = ST.getAllLeaves();
  var emptyLeaf = null;
  for (var i = 0; i < leaves.length; i++) {
    if (leaves[i].panelType === 'empty') { emptyLeaf = leaves[i]; break; }
  }

  if (emptyLeaf) {
    emptyLeaf.panelType = panelType;
    return true;
  }

  var largest = leaves[0];
  if (!largest) return false;
  var result = ST.splitArea(largest.id, 'horizontal', 0.5);
  if (!result) return false;
  var newLeaf = ST.findNode(result.newLeafId);
  if (!newLeaf || newLeaf.type !== 'leaf') return false;
  newLeaf.panelType = panelType;
  return true;
}

function openPanel(name) {
  var ST = window._splitTree;
  var SL = window._splitLayout;
  var panelType = normalizePanelType(name);
  if (!ST || !SL) return;
  if (!isKnownPanelType(panelType)) return;

  if (!isMultiInstance(panelType) && hasOpenPanelType(panelType)) {
    toast('Panel <span class="accent">' + panelType + '</span> already open');
    return;
  }

  if (!placePanelType(panelType)) return;

  SL.render();
  updateViewChecks();
  toast('Panel <span class="accent">' + panelType + '</span> opened');
  autoSaveLayout();
}

function togglePanel(name) {
  var panelType = normalizePanelType(name);
  if (!isKnownPanelType(panelType)) return;
  if (isMultiInstance(panelType)) {
    openPanel(panelType);
    return;
  }
  if (hasOpenPanelType(panelType)) closePanel(panelType);
  else openPanel(panelType);
}

function assignLeafPanel(leafId, panelType) {
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return false;

  var leaf = ST.findNode(leafId);
  var nextType = normalizePanelType(panelType);
  if (!leaf || leaf.type !== 'leaf') return false;
  if (!isKnownPanelType(nextType)) return false;

  var prevType = normalizePanelType(leaf.panelType);
  if (prevType === nextType) return true;

  if (!isMultiInstance(nextType)) {
    var existing = getFirstLeafByPanelType(nextType);
    if (existing && existing.id !== leaf.id) {
      if (prevType && prevType !== 'empty') {
        existing.panelType = prevType;
      } else {
        existing.panelType = 'empty';
      }
    }
  }

  leaf.panelType = nextType;
  SL.render();
  updateViewChecks();
  autoSaveLayout();
  return true;
}

function moveLeafToTarget(sourceLeafId, targetLeafId, dropPos) {
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return false;

  var sourceLeaf = ST.findNode(sourceLeafId);
  var targetLeaf = ST.findNode(targetLeafId);
  if (!sourceLeaf || !targetLeaf) return false;
  if (sourceLeaf.type !== 'leaf' || targetLeaf.type !== 'leaf') return false;
  if (sourceLeaf.id === targetLeaf.id) return false;
  if (sourceLeaf.panelType === 'empty') return false;

  var srcType = normalizePanelType(sourceLeaf.panelType);
  var targetType = normalizePanelType(targetLeaf.panelType);

  if (dropPos === 'center') {
    sourceLeaf.panelType = targetType;
    targetLeaf.panelType = srcType;
    SL.render();
    updateViewChecks();
    autoSaveLayout();
    return true;
  }

  var dir = (dropPos === 'left' || dropPos === 'right') ? 'horizontal' : 'vertical';
  var result = ST.splitArea(targetLeaf.id, dir, 0.5);
  if (!result) return false;
  var newLeaf = ST.findNode(result.newLeafId);
  if (!newLeaf || newLeaf.type !== 'leaf') return false;

  var targetAfterSplit = ST.findNode(targetLeaf.id);
  sourceLeaf.panelType = 'empty';
  collapseEmptyLeaf(sourceLeafId);

  if (dropPos === 'right' || dropPos === 'down') {
    newLeaf.panelType = srcType;
  } else {
    newLeaf.panelType = normalizePanelType(targetAfterSplit.panelType);
    targetAfterSplit.panelType = srcType;
  }

  SL.render();
  updateViewChecks();
  autoSaveLayout();
  return true;
}

function collapseEmptyLeaf(leafId) {
  var ST = window._splitTree;
  if (!ST) return;
  var leaf = ST.findNode(leafId);
  if (!leaf || leaf.type !== 'leaf' || leaf.panelType !== 'empty') return;
  var sibling = ST.findSibling(leafId);
  if (sibling && sibling.type === 'leaf') {
    ST.joinAreas(sibling.id, leafId);
  }
}

function undockLeaf(leafId) {
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return false;
  var leaf = ST.findNode(leafId);
  if (!leaf || leaf.type !== 'leaf' || leaf.panelType === 'empty') return false;

  var panelType = normalizePanelType(leaf.panelType);
  if (!isMultiInstance(panelType) && floatingPanels.some(function (f) { return normalizePanelType(f.panelType) === panelType; })) {
    return false;
  }

  var floatId = 'float_' + (++floatCounter).toString(36);
  floatingPanels.push({
    id: floatId,
    panelType: panelType,
    x: 80 + ((floatCounter * 24) % 220),
    y: 80 + ((floatCounter * 20) % 140),
    width: 460,
    height: 320
  });

  closeLeafById(leaf.id, { silent: true, noSave: true });
  SL.render();
  updateViewChecks();
  autoSaveLayout();
  return true;
}

function redockFloating(floatId) {
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return false;
  var idx = -1;
  for (var i = 0; i < floatingPanels.length; i++) {
    if (floatingPanels[i].id === floatId) { idx = i; break; }
  }
  if (idx < 0) return false;
  var item = floatingPanels[idx];
  if (!placePanelType(item.panelType)) return false;
  floatingPanels.splice(idx, 1);
  SL.render();
  updateViewChecks();
  autoSaveLayout();
  return true;
}

function closeFloating(floatId) {
  var SL = window._splitLayout;
  var idx = -1;
  for (var i = 0; i < floatingPanels.length; i++) {
    if (floatingPanels[i].id === floatId) { idx = i; break; }
  }
  if (idx < 0) return false;
  floatingPanels.splice(idx, 1);
  if (SL) SL.render();
  updateViewChecks();
  autoSaveLayout();
  return true;
}

function updateFloatingRect(floatId, patch) {
  for (var i = 0; i < floatingPanels.length; i++) {
    if (floatingPanels[i].id !== floatId) continue;
    if (patch && isFinite(patch.x)) floatingPanels[i].x = Number(patch.x);
    if (patch && isFinite(patch.y)) floatingPanels[i].y = Number(patch.y);
    if (patch && isFinite(patch.width)) floatingPanels[i].width = Number(patch.width);
    if (patch && isFinite(patch.height)) floatingPanels[i].height = Number(patch.height);
    return true;
  }
  return false;
}

function getFloatingPanels() {
  return floatingPanels.slice();
}

function updateViewChecks() {
  var panelNames = getAllPanelTypes();
  for (var i = 0; i < panelNames.length; i++) {
    var name = panelNames[i];
    var el = document.getElementById(getViewCheckId(name));
    if (!el) continue;
    el.textContent = hasOpenPanelType(name) ? '\u2713' : '';
  }
}

function rebuildViewMenu() {
  var menu = document.getElementById('menu-view');
  if (!menu) return;
  var reg = window._panelRegistry;
  if (!reg || !reg.getPanelOptionGroups) return;

  // Find the marker where panel items start (after the dropdown trigger)
  // We rebuild only the panel toggle items, preserving separator + layout items at the bottom.
  var items = menu.querySelectorAll('.dd-item[data-panel-toggle]');
  for (var i = 0; i < items.length; i++) items[i].remove();

  // Find insertion point: before the first dd-sep in the menu
  var firstSep = menu.querySelector('.dd-sep');
  var groups = reg.getPanelOptionGroups();
  for (var g = 0; g < groups.length; g++) {
    if (g > 0) {
      var sep = document.createElement('div');
      sep.className = 'dd-sep';
      sep.dataset.panelToggle = 'true';
      menu.insertBefore(sep, firstSep);
    }
    for (var p = 0; p < groups[g].options.length; p++) {
      var opt = groups[g].options[p];
      var item = document.createElement('div');
      item.className = 'dd-item';
      item.dataset.panelToggle = 'true';
      var checkId = getViewCheckId(opt.type);
      var isMulti = isMultiInstance(opt.type);
      item.innerHTML = '<span class="dd-check" id="' + checkId + '"></span> ' + opt.label;
      (function (type, multi) {
        item.addEventListener('click', function () {
          if (multi) { window._panels.openPanel(type); }
          else { window._panels.togglePanel(type); }
          if (typeof closeAllMenus === 'function') closeAllMenus();
        });
      })(opt.type, isMulti);
      menu.insertBefore(item, firstSep);
    }
  }
  updateViewChecks();
}

var LAYOUT_KEY = 'ch_split_layout';

function normalizeTree(node) {
  if (!node) return;
  if (node.type === 'leaf') {
    node.panelType = normalizePanelType(node.panelType || 'empty');
    return;
  }
  normalizeTree(node.children && node.children[0]);
  normalizeTree(node.children && node.children[1]);
}

function captureLayout() {
  var ST = window._splitTree;
  if (!ST) return null;
  return { version: 1, tree: ST.serialize(), floating: floatingPanels.slice() };
}

function applyLayout(layout) {
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL || !layout) return;

  if (layout.version === 1 && layout.tree) {
    normalizeTree(layout.tree);
    ST.deserialize(layout.tree);
  } else if (layout.panels && layout.sizes) {
    migrateAndApplyOldLayout(layout);
    return;
  }

  floatingPanels = Array.isArray(layout.floating) ? layout.floating.slice() : [];
  SL.render();
  updateViewChecks();
}

function resetLayout() {
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return;
  ST.deserialize(ST.DEFAULT_TREE);
  floatingPanels = [];
  SL.render();
  updateViewChecks();
  toast('Layout reset to <span class="accent">default</span>');
  try { localStorage.removeItem(LAYOUT_KEY); } catch (e) {}
}

function autoSaveLayout() {
  try {
    var layout = captureLayout();
    if (layout) localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  } catch (e) {}
}

function autoRestoreLayout() {
  try {
    var saved = localStorage.getItem(LAYOUT_KEY);
    if (saved) applyLayout(JSON.parse(saved));
  } catch (e) {}
}

function migrateAndApplyOldLayout(old) {
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return;

  ST.deserialize(ST.DEFAULT_TREE);
  if (old.panels) {
    getAllPanelTypes().forEach(function (name) {
      if (old.panels[name] === false) {
        var leaf = getFirstLeafByPanelType(name);
        if (leaf) leaf.panelType = 'empty';
      }
    });
  }
  floatingPanels = [];
  SL.render();
  updateViewChecks();
  autoSaveLayout();
}

function getSavedLayouts() {
  try { return JSON.parse(localStorage.getItem('ch_saved_layouts') || '{}'); } catch (e) { return {}; }
}
function setSavedLayouts(obj) {
  try { localStorage.setItem('ch_saved_layouts', JSON.stringify(obj)); } catch (e) {}
}

function openSaveModal() {
  document.getElementById('saveModal').classList.add('open');
  var inp = document.getElementById('layoutNameInput');
  inp.value = '';
  setTimeout(function () { inp.focus(); }, 50);
}
function closeSaveModal() {
  document.getElementById('saveModal').classList.remove('open');
}
function saveLayout() {
  var name = document.getElementById('layoutNameInput').value.trim();
  if (!name) return;
  var layouts = getSavedLayouts();
  layouts[name] = captureLayout();
  setSavedLayouts(layouts);
  closeSaveModal();
  buildSavedLayoutsMenu();
  toast('Layout <span class="accent">' + name + '</span> saved');
}

function loadSavedLayout(name) {
  var layouts = getSavedLayouts();
  if (layouts[name]) {
    applyLayout(layouts[name]);
    toast('Layout <span class="accent">' + name + '</span> loaded');
  }
  closeAllMenus();
}

function deleteSavedLayout(name) {
  var layouts = getSavedLayouts();
  delete layouts[name];
  setSavedLayouts(layouts);
  buildSavedLayoutsMenu();
  toast('Layout <span class="accent">' + name + '</span> deleted');
}

function buildSavedLayoutsMenu() {
  var container = document.getElementById('saved-layouts-menu');
  if (!container) return;
  var layouts = getSavedLayouts();
  var names = Object.keys(layouts);
  if (names.length === 0) {
    container.innerHTML = '<div class="dd-item disabled" style="font-style:italic;">No saved layouts</div>';
    return;
  }
  container.innerHTML = names.map(function (n) {
    var safe = n.replace(/'/g, "\\'").replace(/</g, '&lt;');
    return '<div class="dd-item" onclick="window._panels.loadSavedLayout(\'' + safe + '\'); event.stopPropagation();">' +
      '<span>' + safe + '</span>' +
      '<span class="dd-shortcut" style="cursor:pointer;color:var(--accent-red);" onclick="event.stopPropagation(); window._panels.deleteSavedLayout(\'' + safe + '\'); closeAllMenus();">\u2715</span>' +
      '</div>';
  }).join('');
}

var workspacePresets = {
  default: {
    version: 1,
    tree: window._splitTree ? window._splitTree.DEFAULT_TREE : null
  },
  minimal: {
    version: 1,
    tree: {
      type: 'branch', id: 'b_min', direction: 'vertical', ratio: 0.78,
      children: [
        { type: 'leaf', id: 'a_clipper', panelType: 'clipper' },
        { type: 'leaf', id: 'a_tl', panelType: 'timeline' }
      ]
    }
  },
  editing: {
    version: 1,
    tree: {
      type: 'branch', id: 'b_root', direction: 'horizontal', ratio: 0.14,
      children: [
        { type: 'leaf', id: 'a_media', panelType: 'media' },
        { type: 'branch', id: 'b_cr', direction: 'horizontal', ratio: 0.72,
          children: [
            { type: 'branch', id: 'b_cv', direction: 'vertical', ratio: 0.65,
              children: [
                { type: 'leaf', id: 'a_clipper', panelType: 'clipper' },
                { type: 'leaf', id: 'a_timeline', panelType: 'timeline' }
              ]
            },
            { type: 'leaf', id: 'a_clips', panelType: 'clips' }
          ]
        }
      ]
    }
  }
};

function loadWorkspace(name) {
  document.querySelectorAll('.ws-tab').forEach(function (t) { t.classList.remove('active'); });
  var tab = document.querySelector('.ws-tab[data-ws="' + name + '"]');
  if (tab) tab.classList.add('active');
  if (workspacePresets[name]) {
    applyLayout(workspacePresets[name]);
    toast('Workspace <span class="accent">' + name + '</span> loaded');
  }
}

var toastTimer = null;
function toast(html) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2000);
}

document.addEventListener('keydown', function (e) {
  if (e.ctrlKey && e.shiftKey && e.key === 'R') { e.preventDefault(); resetLayout(); }
  if (e.ctrlKey && e.shiftKey && e.key === 'L') { e.preventDefault(); openSaveModal(); }
});

var layoutInput = document.getElementById('layoutNameInput');
if (layoutInput) {
  layoutInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') saveLayout();
    if (e.key === 'Escape') closeSaveModal();
  });
}

document.querySelectorAll('.media-tab').forEach(function (tab) {
  tab.addEventListener('click', function () {
    document.querySelectorAll('.media-tab').forEach(function (t) { t.classList.remove('active'); });
    tab.classList.add('active');
  });
});

// ── Phase 4: Wire remaining panel lifecycle hooks (incremental) ────
// Render functions for these panels live inside renderer.js (off-limits),
// so hooks set up the bus subscription pattern for future decoupling.
(function () {
  var reg = window._panelRegistry;
  if (!reg || !reg.registerLifecycle) return;

  // Timeline: subscribe to player:timeupdate via bus on mount, clean up on unmount
  var _tlUnsub = null;
  reg.registerLifecycle('timeline', {
    mount: function () {
      if (!_tlUnsub && window._panelBus) {
        _tlUnsub = window._panelBus.on('player:timeupdate', function () {
          // Marker rendering handled by renderer.js internally;
          // bus subscription decouples future timeline features from Player.
        });
      }
    },
    unmount: function () {
      if (_tlUnsub) { _tlUnsub(); _tlUnsub = null; }
    }
  });

  // Clips Queue: mount hook placeholder for when renderPendingClips() is exposed
  reg.registerLifecycle('clips', {
    mount: function () { /* clip list renders via renderer.js internally */ }
  });

  // Media Sources: mount hook placeholder for when buffer stats refresh is exposed
  reg.registerLifecycle('media', {
    mount: function () { /* media stats update via Player stream events */ }
  });
})();

buildSavedLayoutsMenu();
rebuildViewMenu();
updateViewChecks();
autoRestoreLayout();

window._panels = {
  closePanel: closePanel,
  closeAreaByLeaf: closeLeafById,
  openPanel: openPanel,
  togglePanel: togglePanel,
  assignLeafPanel: assignLeafPanel,
  moveLeafToTarget: moveLeafToTarget,
  undockLeaf: undockLeaf,
  redockFloating: redockFloating,
  closeFloating: closeFloating,
  updateFloatingRect: updateFloatingRect,
  getFloatingPanels: getFloatingPanels,
  resetLayout: resetLayout,
  openSaveModal: openSaveModal,
  closeSaveModal: closeSaveModal,
  saveLayout: saveLayout,
  loadSavedLayout: loadSavedLayout,
  deleteSavedLayout: deleteSavedLayout,
  loadWorkspace: loadWorkspace,
  autoSaveLayout: autoSaveLayout,
  rebuildViewMenu: rebuildViewMenu,
  toast: toast
};

})();

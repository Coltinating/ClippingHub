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
  return ['clipper', 'viewer', 'media', 'clips', 'collab'];
}

function isAdvancedMode() {
  var cfg = window.userConfig && window.userConfig.devFeatures;
  return !!(cfg && cfg.advancedPanelSystem);
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
document.addEventListener('click', function (e) {
  // Don't close menus when interacting with embedded panes inside dropdowns
  // (e.g. the Edit > Stream Settings URL bar pane).
  if (e.target && e.target.closest && e.target.closest('.edit-stream-pane')) return;
  closeAllMenus();
});

function closeLeafById(leafId, opts) {
  if (!isAdvancedMode()) return false;
  opts = opts || {};
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return false;

  var leaf = ST.findNode(leafId);
  if (!leaf || leaf.type !== 'leaf') return false;

  var sibling = ST.findSibling(leaf.id);
  if (sibling) {
    // Always join — sibling can be leaf OR branch
    ST.joinAreas(sibling.id, leaf.id);
  } else {
    // No sibling = root leaf — set empty
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
  if (!isAdvancedMode()) return;
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
  if (!isAdvancedMode()) return;
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
  if (!isAdvancedMode()) return;
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
  if (!isAdvancedMode()) return false;
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
  if (!isAdvancedMode()) return false;
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
  if (!isAdvancedMode()) return false;
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
  var reg = window._panelRegistry && window._panelRegistry.getPanelInfo(panelType);
  var title = reg ? reg.title : panelType;

  // Get approximate screen position from the area element
  var areaEl = document.querySelector('.split-area[data-node-id="' + leafId + '"]');
  var x, y, w, h;
  if (areaEl) {
    var rect = areaEl.getBoundingClientRect();
    x = Math.round(window.screenX + rect.left);
    y = Math.round(window.screenY + rect.top);
    w = Math.round(rect.width);
    h = Math.round(rect.height);
  }

  floatingPanels.push({
    id: floatId,
    panelType: panelType,
    x: x || 200, y: y || 200,
    width: w || 460, height: h || 320
  });

  // Create real BrowserWindow via IPC
  if (window.clipper && window.clipper.floatCreate) {
    window.clipper.floatCreate({ floatId: floatId, panelType: panelType, x: x, y: y, width: w, height: h, title: title })
      .then(function () {
        // Send initial state to the float window so it can render content
        var PS = window.Player && window.Player.state;
        var state = {
          panelType: panelType,
          proxyPort: PS && PS.proxyPort ? PS.proxyPort : null,
          streamUrl: PS && PS.currentM3U8 ? PS.currentM3U8 : null,
          isLive: PS && PS.isLive ? true : false
        };
        if (window.clipper && window.clipper.floatSendState) {
          // Small delay to let float window finish loading
          setTimeout(function () {
            window.clipper.floatSendState(floatId, state);
          }, 500);
        }
      });
  }

  closeLeafById(leaf.id, { silent: true, noSave: true });
  SL.render();
  updateViewChecks();
  autoSaveLayout();
  return true;
}

function redockFloating(floatId) {
  var SL = window._splitLayout;
  if (!SL) return false;
  var idx = -1;
  for (var i = 0; i < floatingPanels.length; i++) {
    if (floatingPanels[i].id === floatId) { idx = i; break; }
  }
  if (idx === -1) return false;
  var panelType = normalizePanelType(floatingPanels[idx].panelType);
  floatingPanels.splice(idx, 1);

  // Close the BrowserWindow
  if (window.clipper && window.clipper.floatClose) {
    window.clipper.floatClose(floatId);
  }

  placePanelType(panelType);
  SL.render();
  updateViewChecks();
  autoSaveLayout();
  return true;
}

function closeFloating(floatId) {
  if (!isAdvancedMode()) return false;
  var SL = window._splitLayout;
  var idx = -1;
  for (var i = 0; i < floatingPanels.length; i++) {
    if (floatingPanels[i].id === floatId) { idx = i; break; }
  }
  if (idx < 0) return false;
  floatingPanels.splice(idx, 1);

  // Close the BrowserWindow
  if (window.clipper && window.clipper.floatClose) {
    window.clipper.floatClose(floatId);
  }

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
var LEGACY_LAYOUTS_KEY = 'ch_saved_layouts';
var LEGACY_ACTIVE_KEY = 'ch_active_workspace';
var activeWorkspaceKey = 'default';

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
  if (!isAdvancedMode()) return;
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return;
  ST.deserialize(ST.DEFAULT_TREE);
  floatingPanels = [];
  SL.render();
  updateViewChecks();
  hasUnsavedScratch = false;
  if (window.clipper && window.clipper.clearPanelCurrentLayout) {
    window.clipper.clearPanelCurrentLayout().catch(function () {});
  }
  try { localStorage.removeItem(LAYOUT_KEY); } catch (e) {}
  updateActiveTabDirty();
  toast('Layout reset');
}

var hasUnsavedScratch = false;

function autoSaveLayout() {
  // Mutations write to a scratch slot only — named layouts (Minimal, Collaboration,
  // Watch, user-saved) are never overwritten unless the user explicitly clicks
  // "Save Layout".
  var layout = captureLayout();
  if (!layout) return;
  layout.name = '__scratch';
  hasUnsavedScratch = true;
  updateActiveTabDirty();

  if (window.clipper && window.clipper.savePanelCurrentLayout) {
    window.clipper.savePanelCurrentLayout(layout).catch(function () {});
    return;
  }
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch (e) {}
}

function autoRestoreLayout() {
  if (window.clipper && window.clipper.loadPanelLayoutState) {
    return window.clipper.loadPanelLayoutState().then(function (state) {
      var wanted = (state && state.activeWorkspace) ? state.activeWorkspace : 'minimal';
      var layout = builtinLayouts[wanted] || userLayouts[wanted]
        || builtinLayouts.minimal || userLayouts.minimal
        || firstAvailableBuiltin();
      activeWorkspaceKey = layout ? (layout._filename || wanted) : 'minimal';
      if (layout) applyLayout(layout);

      var loadCurrent = (window.clipper && window.clipper.loadPanelCurrentLayout)
        ? window.clipper.loadPanelCurrentLayout()
        : Promise.resolve(null);

      return loadCurrent.then(function (scratch) {
        if (scratch && scratch.tree) {
          applyLayout(scratch);
          hasUnsavedScratch = true;
        } else {
          hasUnsavedScratch = false;
        }
        rebuildWorkspaceTabs(activeWorkspaceKey);
      });
    }).catch(function () {
      rebuildWorkspaceTabs(activeWorkspaceKey);
    });
  }

  try {
    var saved = localStorage.getItem(LAYOUT_KEY);
    activeWorkspaceKey = localStorage.getItem(LEGACY_ACTIVE_KEY) || 'minimal';
    if (saved) applyLayout(JSON.parse(saved));
  } catch (e) {}
  rebuildWorkspaceTabs(activeWorkspaceKey);
  return Promise.resolve();
}

function firstAvailableBuiltin() {
  var keys = Object.keys(builtinLayouts);
  return keys.length ? builtinLayouts[keys[0]] : null;
}

function updateActiveTabDirty() {
  var container = document.querySelector('.workspace-tabs');
  if (!container) return;
  var tabs = container.querySelectorAll('.ws-tab');
  for (var i = 0; i < tabs.length; i++) {
    if (tabs[i].classList.contains('active') && hasUnsavedScratch) {
      tabs[i].classList.add('dirty');
    } else {
      tabs[i].classList.remove('dirty');
    }
  }
}

function redockAllFloating() {
  var ids = floatingPanels.map(function (f) { return f.id; });
  for (var i = 0; i < ids.length; i++) {
    redockFloating(ids[i]);
  }
}

function applyPanelSystemMode() {
  var advanced = isAdvancedMode();
  document.body.classList.toggle('basic-panels', !advanced);

  if (!advanced) {
    redockAllFloating();
    var layout = builtinLayouts[activeWorkspaceKey] || userLayouts[activeWorkspaceKey]
      || builtinLayouts.minimal || firstAvailableBuiltin();
    if (layout) applyLayout(layout);
    if (window.clipper && window.clipper.clearPanelCurrentLayout) {
      window.clipper.clearPanelCurrentLayout().catch(function () {});
    }
    try { localStorage.removeItem(LAYOUT_KEY); } catch (e) {}
    hasUnsavedScratch = false;
  }

  rebuildWorkspaceTabs(activeWorkspaceKey);
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
  return userLayouts;
}

function setSavedLayouts(obj) {
  userLayouts = obj || {};
}

function refreshLayoutCaches() {
  if (!window.clipper || !window.clipper.listPanelLayouts) {
    builtinLayouts = builtinLayouts || {};
    try { userLayouts = JSON.parse(localStorage.getItem(LEGACY_LAYOUTS_KEY) || '{}'); } catch (e) { userLayouts = {}; }
    return Promise.resolve();
  }
  return window.clipper.listPanelLayouts().then(function (layouts) {
    builtinLayouts = {};
    userLayouts = {};
    for (var i = 0; i < layouts.length; i++) {
      var layout = layouts[i];
      var key = layout._filename || layout.key || (layout.name || '').toLowerCase();
      if (!key) continue;
      if (layout._isDefault || layout.isDefault) builtinLayouts[key] = layout;
      else userLayouts[key] = layout;
    }
  }).catch(function () {});
}

function openSaveModal() {
  if (!isAdvancedMode()) return;
  document.getElementById('saveModal').classList.add('open');
  var inp = document.getElementById('layoutNameInput');
  inp.value = '';
  setTimeout(function () { inp.focus(); }, 50);
}
function closeSaveModal() {
  document.getElementById('saveModal').classList.remove('open');
}
function saveLayout() {
  if (!isAdvancedMode()) return;
  var name = document.getElementById('layoutNameInput').value.trim();
  if (!name) return;
  var layout = captureLayout();
  if (!layout) return;

  if (window.clipper && window.clipper.savePanelLayout) {
    window.clipper.savePanelLayout({ name: name, layout: layout }).then(function (result) {
      if (!result || !result.success || !result.layout) {
        toast('Failed to save layout');
        return;
      }
      var key = result.key || result.layout._filename || name;
      userLayouts[key] = result.layout;
      activeWorkspaceKey = key;
      hasUnsavedScratch = false;
      if (window.clipper && window.clipper.clearPanelCurrentLayout) {
        window.clipper.clearPanelCurrentLayout().catch(function () {});
      }
      try { localStorage.removeItem(LAYOUT_KEY); } catch (e) {}
      closeSaveModal();
      buildSavedLayoutsMenu();
      buildBuiltinLayoutsMenu();
      rebuildWorkspaceTabs(key);
      if (window.clipper && window.clipper.savePanelLayoutState) {
        window.clipper.savePanelLayoutState({ activeWorkspace: key }).catch(function () {});
      }
      toast('Layout <span class="accent">' + (result.layout.name || name) + '</span> saved');
    }).catch(function () {
      toast('Failed to save layout');
    });
    return;
  }

  var layouts = getSavedLayouts();
  layouts[name] = layout;
  setSavedLayouts(layouts);
  try { localStorage.setItem(LEGACY_LAYOUTS_KEY, JSON.stringify(layouts)); } catch (e) {}
  closeSaveModal();
  buildSavedLayoutsMenu();
  buildBuiltinLayoutsMenu();
  rebuildWorkspaceTabs(name);
  toast('Layout <span class="accent">' + name + '</span> saved');
}

function loadSavedLayout(name) {
  if (!isAdvancedMode()) return;
  var layouts = getSavedLayouts();
  if (layouts[name]) {
    activeWorkspaceKey = name;
    applyLayout(layouts[name]);
    if (window.clipper && window.clipper.savePanelLayoutState) {
      window.clipper.savePanelLayoutState({ activeWorkspace: name }).catch(function () {});
    }
    buildBuiltinLayoutsMenu();
    toast('Layout <span class="accent">' + name + '</span> loaded');
  }
  closeAllMenus();
}

function deleteSavedLayout(name) {
  if (!isAdvancedMode()) return;
  if (window.clipper && window.clipper.deletePanelLayout) {
    window.clipper.deletePanelLayout(name).then(function (result) {
      if (result && result.success) {
        delete userLayouts[name];
        if (activeWorkspaceKey === name) {
          activeWorkspaceKey = 'default';
          if (window.clipper && window.clipper.savePanelLayoutState) {
            window.clipper.savePanelLayoutState({ activeWorkspace: activeWorkspaceKey }).catch(function () {});
          }
        }
        buildSavedLayoutsMenu();
        buildBuiltinLayoutsMenu();
        rebuildWorkspaceTabs(activeWorkspaceKey);
        toast('Layout <span class="accent">' + name + '</span> deleted');
      } else {
        toast('Layout delete blocked');
      }
    }).catch(function () {
      toast('Failed to delete layout');
    });
    return;
  }

  var layouts = getSavedLayouts();
  delete layouts[name];
  setSavedLayouts(layouts);
  try { localStorage.setItem(LEGACY_LAYOUTS_KEY, JSON.stringify(layouts)); } catch (e) {}
  buildSavedLayoutsMenu();
  buildBuiltinLayoutsMenu();
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
  container.innerHTML = names.map(function (key) {
    var layoutName = layouts[key].name || key;
    var safeKey = key.replace(/'/g, "\\'").replace(/</g, '&lt;');
    var safeLabel = layoutName.replace(/'/g, "\\'").replace(/</g, '&lt;');
    return '<div class="dd-item" onclick="window._panels.loadSavedLayout(\'' + safeKey + '\'); event.stopPropagation();">' +
      '<span>' + safeLabel + '</span>' +
      '<span class="dd-shortcut" style="cursor:pointer;color:var(--accent-red);" onclick="event.stopPropagation(); window._panels.deleteSavedLayout(\'' + safeKey + '\'); closeAllMenus();">\u2715</span>' +
      '</div>';
  }).join('');
}

function buildBuiltinLayoutsMenu() {
  var container = document.getElementById('builtin-layouts-menu');
  if (!container) return;
  var keys = Object.keys(builtinLayouts);
  if (keys.length === 0) {
    container.innerHTML = '<div class="dd-item disabled" style="font-style:italic;">No built-in layouts</div>';
    return;
  }
  container.innerHTML = keys.map(function (key) {
    var layout = builtinLayouts[key];
    var label = (layout && layout.name) ? layout.name : key;
    var safeKey = key.replace(/'/g, "\\'").replace(/</g, '&lt;');
    var safeLabel = String(label).replace(/'/g, "\\'").replace(/</g, '&lt;');
    var marker = (key === activeWorkspaceKey) ? '\u2022' : '';
    return '<div class="dd-item" onclick="window._panels.loadWorkspace(\'' + safeKey + '\'); closeAllMenus();">' +
      '<span class="dd-check">' + marker + '</span>' +
      '<span>' + safeLabel + '</span>' +
      '</div>';
  }).join('');
}

var builtinLayouts = {};
var userLayouts = {};

function loadBuiltinLayouts() {
  if (!window.clipper || !window.clipper.listPanelLayouts) {
    // Fallback: use DEFAULT_TREE for 'default' only
    var ST = window._splitTree;
    if (ST) builtinLayouts['default'] = { name: 'Default', version: 1, tree: ST.DEFAULT_TREE };
    return refreshLayoutCaches();
  }
  return refreshLayoutCaches();
}

function loadWorkspace(name) {
  var layout = builtinLayouts[name] || userLayouts[name];
  if (!layout) return;
  activeWorkspaceKey = name;
  applyLayout(layout);
  hasUnsavedScratch = false;
  if (window.clipper && window.clipper.clearPanelCurrentLayout) {
    window.clipper.clearPanelCurrentLayout().catch(function () {});
  }
  try { localStorage.removeItem(LAYOUT_KEY); } catch (e) {}
  rebuildWorkspaceTabs(name);
  buildBuiltinLayoutsMenu();
  if (window.clipper && window.clipper.savePanelLayoutState) {
    window.clipper.savePanelLayoutState({ activeWorkspace: name }).catch(function () {});
  }
  toast('Layout <span class="accent">' + (layout.name || name) + '</span> loaded');
}

function rebuildWorkspaceTabs(activeName) {
  var container = document.querySelector('.workspace-tabs');
  if (!container) return;
  container.innerHTML = '';

  var builtinKeys = Object.keys(builtinLayouts);
  for (var i = 0; i < builtinKeys.length; i++) {
    var bk = builtinKeys[i];
    var bLayout = builtinLayouts[bk];
    var bTab = document.createElement('div');
    bTab.className = 'ws-tab' + (bk === activeName ? ' active' : '');
    bTab.dataset.ws = bk;
    bTab.textContent = bLayout.name || bk;
    (function (key) {
      bTab.addEventListener('click', function () { loadWorkspace(key); });
    })(bk);
    container.appendChild(bTab);
  }

  var userKeys = isAdvancedMode() ? Object.keys(userLayouts) : [];
  if (userKeys.length > 0 && builtinKeys.length > 0) {
    var sep = document.createElement('div');
    sep.className = 'ws-tab-sep';
    container.appendChild(sep);
  }

  for (var j = 0; j < userKeys.length; j++) {
    var uk = userKeys[j];
    var uTab = document.createElement('div');
    uTab.className = 'ws-tab ws-tab-user' + (uk === activeName ? ' active' : '');
    uTab.dataset.ws = uk;
    uTab.textContent = (userLayouts[uk] && userLayouts[uk].name) ? userLayouts[uk].name : uk;
    var closeBtn = document.createElement('span');
    closeBtn.className = 'ws-tab-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.title = 'Delete layout';
    (function (key) {
      uTab.addEventListener('click', function (e) {
        if (e.target.classList.contains('ws-tab-close')) return;
        loadWorkspace(key);
      });
      closeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        deleteSavedLayout(key);
        rebuildWorkspaceTabs(null);
      });
    })(uk);
    uTab.appendChild(closeBtn);
    container.appendChild(uTab);
  }

  updateActiveTabDirty();
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
window.toast = toast;

document.addEventListener('keydown', function (e) {
  if (!isAdvancedMode()) return;
  // Read user-configured layout shortcuts; fall back to defaults if registry unavailable.
  var kb = (window.userConfig && window.userConfig.keybinds) || {};
  var resetBind = kb.resetLayout || 'ctrl+shift+r';
  var saveBind  = kb.saveLayout  || 'ctrl+shift+l';
  var match = (window.Player && window.Player.keybinds && window.Player.keybinds.matchKeybind)
    || function (ev, bind) {
      if (!bind) return false;
      var parts = String(bind).toLowerCase().split('+');
      var key = parts[parts.length - 1];
      if ((parts.indexOf('ctrl')  !== -1) !== ev.ctrlKey)  return false;
      if ((parts.indexOf('shift') !== -1) !== ev.shiftKey) return false;
      if ((parts.indexOf('alt')   !== -1) !== ev.altKey)   return false;
      return ev.key.toLowerCase() === key;
    };
  if (match(e, resetBind)) { e.preventDefault(); resetLayout(); return; }
  if (match(e, saveBind))  { e.preventDefault(); openSaveModal(); return; }
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

  // Clips Queue: mount hook placeholder for when renderPendingClips() is exposed
  reg.registerLifecycle('clips', {
    mount: function () { /* clip list renders via renderer.js internally */ }
  });

  // Media Sources: mount hook placeholder for when buffer stats refresh is exposed
  reg.registerLifecycle('media', {
    mount: function () { /* media stats update via Player stream events */ }
  });
})();

// ── Float window event listeners (BrowserWindow IPC) ───────────────
if (window.clipper && window.clipper.onFloatClosed) {
  window.clipper.onFloatClosed(function (floatId) {
    var idx = -1;
    for (var i = 0; i < floatingPanels.length; i++) {
      if (floatingPanels[i].id === floatId) { idx = i; break; }
    }
    if (idx !== -1) {
      floatingPanels.splice(idx, 1);
      updateViewChecks();
      autoSaveLayout();
    }
  });
}

if (window.clipper && window.clipper.onFloatMoved) {
  window.clipper.onFloatMoved(function (data) {
    updateFloatingRect(data.floatId, { x: data.x, y: data.y });
  });
}

if (window.clipper && window.clipper.onFloatResized) {
  window.clipper.onFloatResized(function (data) {
    updateFloatingRect(data.floatId, { width: data.width, height: data.height });
  });
}

// Handle messages from float windows
if (window.clipper && window.clipper.onFloatMessage) {
  window.clipper.onFloatMessage(function (data) {
    if (data.channel === 'set-playback' && data.data && data.data.time != null) {
      if (window.Player && window.Player.els && window.Player.els.vid) {
        window.Player.els.vid.currentTime = data.data.time;
        toast('Clipper set to ' + Math.floor(data.data.time) + 's');
      }
    }

    // Dock-drag: float window grip was grabbed, window is now hidden,
    // main window takes over with a ghost + drop zones.
    if (data.channel === 'dock-drag-request') {
      startFloatDockDrag(data.floatId, data.data);
    }
  });
}

function startFloatDockDrag(floatId, info) {
  if (!isAdvancedMode()) return;
  var SL = window._splitLayout;
  var ST = window._splitTree;
  if (!SL || !ST) return;

  // Find the floating panel entry
  var floatEntry = null;
  for (var i = 0; i < floatingPanels.length; i++) {
    if (floatingPanels[i].id === floatId) { floatEntry = floatingPanels[i]; break; }
  }
  if (!floatEntry) return;

  var pType = normalizePanelType(floatEntry.panelType);
  var reg = window._panelRegistry && window._panelRegistry.getPanelInfo(pType);
  var title = reg ? reg.title : pType;

  // Create drag ghost in main window
  var ghost = document.createElement('div');
  ghost.className = 'area-drag-ghost';
  ghost.textContent = title;
  document.body.appendChild(ghost);

  var targetLeafId = null;
  var dropPos = null;

  function getDropPosition(area, cx, cy) {
    var r = area.getBoundingClientRect();
    var xPad = Math.max(32, r.width * 0.24);
    var yPad = Math.max(26, r.height * 0.24);
    if (cx < r.left + xPad) return 'left';
    if (cx > r.right - xPad) return 'right';
    if (cy < r.top + yPad) return 'up';
    if (cy > r.bottom - yPad) return 'down';
    return 'center';
  }

  function clearPreview() {
    var prev = document.querySelector('.area-drop-preview');
    if (prev) prev.remove();
  }

  function showPreview(area, pos) {
    clearPreview();
    var pv = document.createElement('div');
    pv.className = 'area-drop-preview area-drop-' + pos;
    area.appendChild(pv);
  }

  var onMove = function (ev) {
    ghost.style.left = (ev.clientX + 16) + 'px';
    ghost.style.top = (ev.clientY + 12) + 'px';

    var hit = document.elementFromPoint(ev.clientX, ev.clientY);
    var area = hit ? hit.closest('.split-area') : null;
    if (!area) {
      targetLeafId = null;
      dropPos = null;
      clearPreview();
      return;
    }
    targetLeafId = area.dataset.nodeId;
    dropPos = getDropPosition(area, ev.clientX, ev.clientY);
    showPreview(area, dropPos);
  };

  var onUp = function () {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    ghost.remove();
    clearPreview();

    if (targetLeafId && dropPos) {
      // Dock the panel into the tree at the target position
      var targetLeaf = ST.findNode(targetLeafId);
      if (targetLeaf && targetLeaf.type === 'leaf') {
        if (dropPos === 'center') {
          // Swap: put float panel type into target leaf, target becomes whatever it was
          var oldType = normalizePanelType(targetLeaf.panelType);
          targetLeaf.panelType = pType;
          // If old type isn't empty, it's displaced — open it elsewhere or drop it
          if (oldType && oldType !== 'empty' && oldType !== pType) {
            placePanelType(oldType);
          }
        } else {
          // Split target area and place float panel in new leaf
          var dir = (dropPos === 'left' || dropPos === 'right') ? 'horizontal' : 'vertical';
          var result = ST.splitArea(targetLeafId, dir, 0.5);
          if (result) {
            var newLeaf = ST.findNode(result.newLeafId);
            if (newLeaf) {
              if (dropPos === 'right' || dropPos === 'down') {
                newLeaf.panelType = pType;
              } else {
                newLeaf.panelType = normalizePanelType(targetLeaf.panelType);
                targetLeaf.panelType = pType;
              }
            }
          }
        }

        // Remove from floating panels and close the BrowserWindow
        for (var j = 0; j < floatingPanels.length; j++) {
          if (floatingPanels[j].id === floatId) { floatingPanels.splice(j, 1); break; }
        }
        if (window.clipper && window.clipper.floatClose) {
          window.clipper.floatClose(floatId);
        }

        SL.render();
        updateViewChecks();
        autoSaveLayout();
        return;
      }
    }

    // Drop missed — re-show the float window
    if (window.clipper && window.clipper.floatShow) {
      window.clipper.floatShow(floatId);
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// Note: rebuildViewMenu() intentionally NOT called — the new View menu is layout-only
// (panel toggles live in layouts themselves). Function kept for API back-compat.
updateViewChecks();

loadBuiltinLayouts().then(function () {
  buildSavedLayoutsMenu();
  buildBuiltinLayoutsMenu();
  return autoRestoreLayout();
}).then(function () {
  buildSavedLayoutsMenu();
  buildBuiltinLayoutsMenu();
  applyPanelSystemMode();
}).catch(function () {});

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
  rebuildWorkspaceTabs: rebuildWorkspaceTabs,
  autoSaveLayout: autoSaveLayout,
  rebuildViewMenu: rebuildViewMenu,
  buildBuiltinLayoutsMenu: buildBuiltinLayoutsMenu,
  buildSavedLayoutsMenu: buildSavedLayoutsMenu,
  applyPanelSystemMode: applyPanelSystemMode,
  isAdvancedMode: isAdvancedMode,
  toast: toast
};

})();

// ── Auto-update UI wiring ─────────────────────────────────────────
(function initUpdateUI() {
  var api = window.clipper;
  if (!api || !api.onUpdateAvailable) return;

  var popup      = document.getElementById('update-popup');
  var popupMsg   = document.getElementById('update-popup-msg');
  var applyBtn   = document.getElementById('update-popup-apply');
  var dismissBtn = document.getElementById('update-popup-dismiss');
  var menuSep    = document.getElementById('menu-file-update-sep');
  var menuItem   = document.getElementById('menu-file-update');

  var pending = null;
  var downloading = false;

  function say(msg) {
    if (window._panels && typeof window._panels.toast === 'function') {
      window._panels.toast(msg);
    }
  }
  function showPopup() { if (popup) popup.hidden = false; }
  function hidePopup() { if (popup) popup.hidden = true; }
  function showMenuItem() {
    if (menuItem) menuItem.style.display = '';
    if (menuSep)  menuSep.style.display  = '';
  }
  function startDownload() {
    if (!pending || downloading) return;
    downloading = true;
    say('Downloading update&hellip;');
    api.downloadUpdate();
  }

  api.onUpdateAvailable(function (info) {
    pending = info;
    if (popupMsg) popupMsg.textContent = 'ClippingHub v' + info.version + ' is available.';
    showPopup();
  });
  api.onUpdateProgress(function (p) {
    say('Downloading update&hellip; ' + p.percent + '%');
  });
  api.onUpdateDownloaded(function () {
    say('Update ready \u2014 restarting\u2026');
    setTimeout(function () { api.installUpdate(); }, 800);
  });
  api.onUpdateError(function (msg) {
    downloading = false;
    say('Update failed: ' + msg);
  });

  if (applyBtn)   applyBtn.addEventListener('click', function () { hidePopup(); startDownload(); });
  if (dismissBtn) dismissBtn.addEventListener('click', function () { hidePopup(); showMenuItem(); });

  window._update = {
    applyFromMenu: function () { hidePopup(); startDownload(); }
  };
})();

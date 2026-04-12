/* ═══════════════════════════════════════════════════════════════
   CLIPPING HUB — Panel Layout System (Split Tree Facade)
   Delegates to split-tree.js / split-layout.js for layout,
   keeps: dropdown menus, toast, keyboard shortcuts, named layouts.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';

// ─── DROPDOWN MENUS ──────────────────────────────────────
let openMenu = null;

document.querySelectorAll('.menu-item[data-menu]').forEach(item => {
  item.addEventListener('click', e => {
    e.stopPropagation();
    const dd = document.getElementById('menu-' + item.dataset.menu);
    if (dd === openMenu) { closeAllMenus(); return; }
    closeAllMenus();
    dd.classList.add('open');
    openMenu = dd;
  });
  item.addEventListener('mouseenter', () => {
    if (!openMenu) return;
    const dd = document.getElementById('menu-' + item.dataset.menu);
    if (dd !== openMenu) {
      closeAllMenus();
      dd.classList.add('open');
      openMenu = dd;
    }
  });
});

window.closeAllMenus = function () {
  document.querySelectorAll('.dropdown').forEach(d => d.classList.remove('open'));
  openMenu = null;
  // Also close split context menu
  if (window._splitInteract) window._splitInteract.hideContextMenu();
};
document.addEventListener('click', closeAllMenus);

// ─── PANEL VISIBILITY (via split tree) ───────────────────

function closePanel(name) {
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return;

  var leaf = ST.getLeafByPanelType(name);
  if (!leaf) return;

  // Find sibling and join
  var sibling = ST.findSibling(leaf.id);
  if (sibling) {
    // If sibling is a leaf, join (sibling absorbs this one)
    if (sibling.type === 'leaf') {
      ST.joinAreas(sibling.id, leaf.id);
    } else {
      // If sibling is a branch, just set this leaf to empty
      leaf.panelType = 'empty';
    }
  } else {
    // It's the only area (root leaf) — just mark empty
    leaf.panelType = 'empty';
  }

  SL.render();
  updateViewChecks();
  toast('Panel <span class="accent">' + name + '</span> closed');
  autoSaveLayout();
}

function openPanel(name) {
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return;

  // Check if already open
  if (ST.getLeafByPanelType(name)) {
    toast('Panel <span class="accent">' + name + '</span> already open');
    return;
  }

  // Find an empty leaf to put it in
  var leaves = ST.getAllLeaves();
  var emptyLeaf = null;
  for (var i = 0; i < leaves.length; i++) {
    if (leaves[i].panelType === 'empty') { emptyLeaf = leaves[i]; break; }
  }

  if (emptyLeaf) {
    emptyLeaf.panelType = name;
  } else {
    // No empty leaf — split the largest area
    var largest = leaves[0];
    // (simple: just split the first leaf)
    var result = ST.splitArea(largest.id, 'horizontal', 0.5);
    if (result) {
      var newLeaf = ST.findNode(result.newLeafId);
      if (newLeaf) newLeaf.panelType = name;
    }
  }

  SL.render();
  updateViewChecks();
  toast('Panel <span class="accent">' + name + '</span> opened');
  autoSaveLayout();
}

function togglePanel(name) {
  var ST = window._splitTree;
  if (!ST) return;
  var leaf = ST.getLeafByPanelType(name);
  if (leaf) closePanel(name);
  else openPanel(name);
}

function updateViewChecks() {
  var ST = window._splitTree;
  if (!ST) return;
  var panelNames = ['media', 'preview', 'timeline', 'clips'];
  for (var i = 0; i < panelNames.length; i++) {
    var name = panelNames[i];
    var el = document.getElementById('chk-' + name);
    if (el) el.textContent = ST.getLeafByPanelType(name) ? '\u2713' : '';
  }
}

// ─── LAYOUT SAVE/LOAD/RESET (tree-based) ─────────────────

var LAYOUT_KEY = 'ch_split_layout';

function captureLayout() {
  var ST = window._splitTree;
  if (!ST) return null;
  return { version: 1, tree: ST.serialize() };
}

function applyLayout(layout) {
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return;

  if (layout.version === 1 && layout.tree) {
    ST.deserialize(layout.tree);
  } else if (layout.panels && layout.sizes) {
    // Old format migration
    migrateAndApplyOldLayout(layout);
    return;
  }

  SL.render();
  updateViewChecks();
}

function resetLayout() {
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return;

  ST.deserialize(ST.DEFAULT_TREE);
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
    if (saved) {
      applyLayout(JSON.parse(saved));
    }
  } catch (e) {}
}

// ─── OLD FORMAT MIGRATION ────────────────────────────────

function migrateAndApplyOldLayout(old) {
  // old = { panels: {media:bool,...}, sizes: {media:px, clips:px,...} }
  var ST = window._splitTree;
  var SL = window._splitLayout;
  if (!ST || !SL) return;

  // Start from default tree
  ST.deserialize(ST.DEFAULT_TREE);

  // Close panels that were hidden
  if (old.panels) {
    ['media', 'preview', 'timeline', 'clips'].forEach(function (name) {
      if (old.panels[name] === false) {
        var leaf = ST.getLeafByPanelType(name);
        if (leaf) leaf.panelType = 'empty';
      }
    });
  }

  SL.render();
  updateViewChecks();
  autoSaveLayout(); // Re-save in new format

  // Clean up old keys
  try {
    localStorage.removeItem('ch_autosave_layout');
    localStorage.removeItem('ch_tabgroups');
  } catch (e) {}
}

// ─── NAMED LAYOUT SAVE/LOAD ─────────────────────────────

function getSavedLayouts() {
  try { return JSON.parse(localStorage.getItem('ch_saved_layouts') || '{}'); } catch (e) { return {}; }
}
function setSavedLayouts(obj) {
  try { localStorage.setItem('ch_saved_layouts', JSON.stringify(obj)); } catch (e) {}
}

function openSaveModal() {
  document.getElementById('saveModal').classList.add('open');
  const inp = document.getElementById('layoutNameInput');
  inp.value = '';
  setTimeout(() => inp.focus(), 50);
}
function closeSaveModal() {
  document.getElementById('saveModal').classList.remove('open');
}
function saveLayout() {
  const name = document.getElementById('layoutNameInput').value.trim();
  if (!name) return;
  const layouts = getSavedLayouts();
  layouts[name] = captureLayout();
  setSavedLayouts(layouts);
  closeSaveModal();
  buildSavedLayoutsMenu();
  toast('Layout <span class="accent">' + name + '</span> saved');
}

function loadSavedLayout(name) {
  const layouts = getSavedLayouts();
  if (layouts[name]) {
    applyLayout(layouts[name]);
    toast('Layout <span class="accent">' + name + '</span> loaded');
  }
  closeAllMenus();
}

function deleteSavedLayout(name) {
  const layouts = getSavedLayouts();
  delete layouts[name];
  setSavedLayouts(layouts);
  buildSavedLayoutsMenu();
  toast('Layout <span class="accent">' + name + '</span> deleted');
}

function buildSavedLayoutsMenu() {
  const container = document.getElementById('saved-layouts-menu');
  if (!container) return;
  const layouts = getSavedLayouts();
  const names = Object.keys(layouts);
  if (names.length === 0) {
    container.innerHTML = '<div class="dd-item disabled" style="font-style:italic;">No saved layouts</div>';
    return;
  }
  container.innerHTML = names.map(n => {
    const safe = n.replace(/'/g, "\\'").replace(/</g, '&lt;');
    return '<div class="dd-item" onclick="window._panels.loadSavedLayout(\'' + safe + '\'); event.stopPropagation();">' +
      '<span>' + safe + '</span>' +
      '<span class="dd-shortcut" style="cursor:pointer;color:var(--accent-red);" ' +
      'onclick="event.stopPropagation(); window._panels.deleteSavedLayout(\'' + safe + '\'); closeAllMenus();">\u2715</span>' +
      '</div>';
  }).join('');
}

// ─── WORKSPACE PRESETS (tree-based) ──────────────────────

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
        { type: 'leaf', id: 'a_prev', panelType: 'preview' },
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
                { type: 'leaf', id: 'a_preview', panelType: 'preview' },
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
  document.querySelectorAll('.ws-tab').forEach(t => t.classList.remove('active'));
  const tab = document.querySelector('.ws-tab[data-ws="' + name + '"]');
  if (tab) tab.classList.add('active');
  if (workspacePresets[name]) {
    applyLayout(workspacePresets[name]);
    toast('Workspace <span class="accent">' + name + '</span> loaded');
  }
}

// ─── TOAST SYSTEM ────────────────────────────────────────
let toastTimer = null;
function toast(html) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = html;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ─── KEYBOARD SHORTCUTS ─────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.shiftKey && e.key === 'R') { e.preventDefault(); resetLayout(); }
  if (e.ctrlKey && e.shiftKey && e.key === 'L') { e.preventDefault(); openSaveModal(); }
});

const layoutInput = document.getElementById('layoutNameInput');
if (layoutInput) {
  layoutInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') saveLayout();
    if (e.key === 'Escape') closeSaveModal();
  });
}

// ─── MEDIA TABS ──────────────────────────────────────────
document.querySelectorAll('.media-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.media-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
  });
});

// ─── INIT ────────────────────────────────────────────────
buildSavedLayoutsMenu();
updateViewChecks();

// Restore saved layout (overrides split-layout.js default render)
autoRestoreLayout();

// ─── EXPOSE PUBLIC API ──────────────────────────────────
window._panels = {
  closePanel,
  openPanel,
  togglePanel,
  resetLayout,
  openSaveModal,
  closeSaveModal,
  saveLayout,
  loadSavedLayout,
  deleteSavedLayout,
  loadWorkspace,
  autoSaveLayout,
  toast
};

})();

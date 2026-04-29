/* ═══════════════════════════════════════════════════════════════
   CLIPPING HUB — Tab Group System (Phase 3a)
   Panels can share a container as tabs. View menu integration.
   Foundation for full drag-and-dock in later phases.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';

var groups = {};
var groupCounter = 0;

var PANEL_LABELS = {
  media: 'Media Sources',
  preview: 'Preview',
  clipper: 'Clipper',
  viewer: 'Viewer',
  collab: 'Collab',
  clips: 'Clips Queue'
};

// ─── CREATE TAB GROUP ────────────────────────────────────
function createTabGroup(panelNames, targetSlot) {
  var groupId = 'tg-' + (++groupCounter);

  var container = document.createElement('div');
  container.className = 'tab-group';
  container.dataset.groupId = groupId;

  var tabBar = document.createElement('div');
  tabBar.className = 'tab-bar';
  container.appendChild(tabBar);

  var body = document.createElement('div');
  body.className = 'tab-group-body';
  container.appendChild(body);

  var validNames = [];

  panelNames.forEach(function (name) {
    var pane = document.getElementById('pane-' + name);
    if (!pane) return;

    // Create tab button
    var tab = document.createElement('div');
    tab.className = 'tab-item';
    tab.dataset.panel = name;

    var label = document.createTextNode(PANEL_LABELS[name] || name);
    tab.appendChild(label);

    var closeBtn = document.createElement('span');
    closeBtn.className = 'tab-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      removeFromGroup(groupId, name);
    });
    tab.appendChild(closeBtn);

    tab.addEventListener('click', function () {
      activateTab(groupId, name);
    });
    tabBar.appendChild(tab);

    // Store original position info for ungrouping
    pane.dataset.tgOrigParent = pane.parentElement ? pane.parentElement.id || '' : '';
    pane.dataset.tgOrigWidth = pane.style.width || '';
    pane.dataset.tgOrigHeight = pane.style.height || '';
    pane.dataset.tgOrigFlex = pane.style.flex || '';

    // Move pane into group body
    body.appendChild(pane);
    pane.style.width = '';
    pane.style.height = '';
    pane.style.flex = '';
    pane.style.display = '';

    // Ensure panel is visible (in case it was closed)
    if (window._panels) {
      window._panels.openPanel(name);
    }

    validNames.push(name);
  });

  if (validNames.length === 0) {
    container.remove();
    return null;
  }

  targetSlot.appendChild(container);

  groups[groupId] = {
    container: container,
    tabs: validNames.slice(),
    active: validNames[0]
  };

  activateTab(groupId, validNames[0]);
  saveTabGroupState();

  return groupId;
}

// ─── ACTIVATE TAB ────────────────────────────────────────
function activateTab(groupId, panelName) {
  var group = groups[groupId];
  if (!group) return;
  group.active = panelName;

  // Update tab bar
  var tabs = group.container.querySelectorAll('.tab-item');
  for (var i = 0; i < tabs.length; i++) {
    tabs[i].classList.toggle('active', tabs[i].dataset.panel === panelName);
  }

  // Show/hide panes
  var panes = group.container.querySelectorAll('.tab-group-body > .dock-pane');
  for (var j = 0; j < panes.length; j++) {
    var name = panes[j].dataset.panel || panes[j].id.replace('pane-', '');
    var isActive = name === panelName;
    panes[j].classList.toggle('tab-active', isActive);
    panes[j].style.display = '';
  }
}

// ─── REMOVE FROM GROUP ───────────────────────────────────
function removeFromGroup(groupId, panelName) {
  var group = groups[groupId];
  if (!group) return;

  var idx = group.tabs.indexOf(panelName);
  if (idx === -1) return;
  group.tabs.splice(idx, 1);

  // Remove tab button
  var tab = group.container.querySelector('.tab-item[data-panel="' + panelName + '"]');
  if (tab) tab.remove();

  // Close the panel via panels.js
  if (window._panels) {
    window._panels.closePanel(panelName);
  }

  // If <=1 tabs, dissolve group
  if (group.tabs.length <= 1) {
    dissolveGroup(groupId);
    return;
  }

  // Activate another tab if current was removed
  if (group.active === panelName) {
    activateTab(groupId, group.tabs[0]);
  }

  saveTabGroupState();
}

// ─── DISSOLVE GROUP ──────────────────────────────────────
function dissolveGroup(groupId) {
  var group = groups[groupId];
  if (!group) return;

  var parent = group.container.parentElement;
  if (!parent) { delete groups[groupId]; return; }

  // Move remaining panes back out
  var panes = group.container.querySelectorAll('.tab-group-body > .dock-pane');
  for (var i = 0; i < panes.length; i++) {
    var pane = panes[i];
    pane.classList.remove('tab-active');
    pane.style.display = '';
    // Restore original sizing
    if (pane.dataset.tgOrigWidth) pane.style.width = pane.dataset.tgOrigWidth;
    if (pane.dataset.tgOrigHeight) pane.style.height = pane.dataset.tgOrigHeight;
    if (pane.dataset.tgOrigFlex) pane.style.flex = pane.dataset.tgOrigFlex;
    parent.insertBefore(pane, group.container);
  }

  group.container.remove();
  delete groups[groupId];
  saveTabGroupState();
}

// ─── DISSOLVE ALL ────────────────────────────────────────
function dissolveAll() {
  var ids = Object.keys(groups);
  for (var i = 0; i < ids.length; i++) {
    dissolveGroup(ids[i]);
  }
}

// ─── PERSISTENCE ─────────────────────────────────────────
function saveTabGroupState() {
  try {
    var state = {};
    for (var id in groups) {
      state[id] = { tabs: groups[id].tabs, active: groups[id].active };
    }
    localStorage.setItem('ch_tabgroups', JSON.stringify(state));
  } catch (e) {}
}

function restoreTabGroupState() {
  try {
    var raw = localStorage.getItem('ch_tabgroups');
    if (!raw) return;
    var state = JSON.parse(raw);
    var ids = Object.keys(state);
    if (ids.length === 0) return;

    // For each saved group, recreate it
    for (var i = 0; i < ids.length; i++) {
      var saved = state[ids[i]];
      if (!saved.tabs || saved.tabs.length < 2) continue;

      // Find a suitable target: the dock-root or a parent container
      var firstPane = document.getElementById('pane-' + saved.tabs[0]);
      if (!firstPane || !firstPane.parentElement) continue;

      var target = firstPane.parentElement;

      // Hide adjacent splitters for all panes being grouped
      saved.tabs.forEach(function (name) {
        var pane = document.getElementById('pane-' + name);
        if (!pane) return;
        var prev = pane.previousElementSibling;
        var next = pane.nextElementSibling;
        if (prev && prev.classList.contains('splitter')) prev.style.display = 'none';
        else if (next && next.classList.contains('splitter')) next.style.display = 'none';
      });

      var gid = createTabGroup(saved.tabs, target);
      if (gid && saved.active) {
        activateTab(gid, saved.active);
      }
    }
  } catch (e) {}
}

// ─── VIEW MENU INTEGRATION ──────────────────────────────
function addViewMenuItems() {
  var viewMenu = document.getElementById('menu-view');
  if (!viewMenu) return;

  // Find the Reset Layout item to insert before it
  var items = viewMenu.querySelectorAll('.dd-item');
  var resetItem = null;
  for (var i = 0; i < items.length; i++) {
    if (items[i].textContent.indexOf('Reset Layout') !== -1) {
      resetItem = items[i];
      break;
    }
  }

  // Insert separator + group options before Reset Layout
  var sep = document.createElement('div');
  sep.className = 'dd-sep';

  var groupItem = document.createElement('div');
  groupItem.className = 'dd-item';
  groupItem.innerHTML = 'Group: Media + Clips';
  groupItem.addEventListener('click', function () {
    closeAllMenus();
    groupMediaAndClips();
  });

  var ungroupItem = document.createElement('div');
  ungroupItem.className = 'dd-item';
  ungroupItem.innerHTML = 'Ungroup All Tabs';
  ungroupItem.addEventListener('click', function () {
    closeAllMenus();
    dissolveAll();
    if (typeof toast === 'function') toast('All tab groups dissolved');
    else if (window._panels && window._panels.toast) window._panels.toast('All tab groups dissolved');
  });

  if (resetItem) {
    viewMenu.insertBefore(sep, resetItem);
    viewMenu.insertBefore(groupItem, resetItem);
    viewMenu.insertBefore(ungroupItem, resetItem);
  }
}

function groupMediaAndClips() {
  // Dissolve existing groups first
  dissolveAll();

  var mediaPane = document.getElementById('pane-media');
  var clipsPane = document.getElementById('pane-clips');
  if (!mediaPane || !clipsPane) return;

  // Hide splitters adjacent to both panes
  hideSplitterFor(mediaPane);
  hideSplitterFor(clipsPane);

  // Create a target wrapper in the left slot
  var dockRoot = document.getElementById('dockRoot');
  if (!dockRoot) return;

  var wrapper = document.createElement('div');
  wrapper.className = 'dock-pane';
  wrapper.id = 'tg-wrapper-mc';
  wrapper.style.width = '260px';
  wrapper.style.flexShrink = '0';

  // Insert before the first splitter
  var firstSplitter = dockRoot.querySelector('.splitter.h');
  if (firstSplitter) {
    dockRoot.insertBefore(wrapper, firstSplitter);
  } else {
    dockRoot.insertBefore(wrapper, dockRoot.firstChild);
  }

  createTabGroup(['media', 'clips'], wrapper);

  // Show a toast
  var toastFn = window._panels && window._panels.toast;
  if (!toastFn) {
    var toastEl = document.getElementById('toast');
    if (toastEl) {
      toastEl.innerHTML = 'Grouped <span class="accent">Media + Clips</span>';
      toastEl.classList.add('show');
      setTimeout(function () { toastEl.classList.remove('show'); }, 2000);
    }
  }
}

function hideSplitterFor(pane) {
  var prev = pane.previousElementSibling;
  var next = pane.nextElementSibling;
  if (prev && prev.classList.contains('splitter')) prev.style.display = 'none';
  else if (next && next.classList.contains('splitter')) next.style.display = 'none';
}

// ─── HOOK INTO LAYOUT RESET ─────────────────────────────
// Watch for reset: when panels.js resets, dissolve all tab groups
var origReset = window._panels && window._panels.resetLayout;
if (origReset) {
  window._panels.resetLayout = function () {
    dissolveAll();
    try { localStorage.removeItem('ch_tabgroups'); } catch (e) {}
    origReset.call(window._panels);
  };
}

// ─── INIT ────────────────────────────────────────────────
addViewMenuItems();
// Restore saved tab groups after a short delay to let panels.js init
setTimeout(function () {
  restoreTabGroupState();
}, 100);

// ─── EXPOSE API ──────────────────────────────────────────
window._tabGroups = {
  createTabGroup: createTabGroup,
  activateTab: activateTab,
  removeFromGroup: removeFromGroup,
  dissolveGroup: dissolveGroup,
  dissolveAll: dissolveAll,
  groups: groups
};

})();

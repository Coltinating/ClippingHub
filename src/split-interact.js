(function () {
'use strict';

var ST, SL;
var MIN_RATIO = 0.05;
var SNAP_POINTS = [0.15, 0.2, 0.25, 0.333, 0.5, 0.667, 0.75, 0.8, 0.85];
var SNAP_THRESHOLD = 0.015;
var DRAG_THRESHOLD = 20;
var _menuBranchId = null;

function triggerSave() {
  if (window._panels && window._panels.autoSaveLayout) {
    window._panels.autoSaveLayout();
  }
}

function initDividerResize() {
  var dockRoot = document.getElementById('dockRoot');
  if (!dockRoot) return;
  dockRoot.addEventListener('mousedown', function (e) {
    var divider = e.target.closest('.split-divider');
    if (!divider || e.button !== 0) return;
    e.preventDefault();
    startDividerDrag(divider, e);
  });
}

function startDividerDrag(divider, e) {
  var branchId = divider.dataset.branchId;
  var branch = ST.findNode(branchId);
  if (!branch || branch.type !== 'branch') return;

  var isHoriz = branch.direction === 'horizontal';
  divider.classList.add('dragging');
  var container = divider.parentElement;
  if (!container) return;

  var onMove = function (ev) {
    var rect = container.getBoundingClientRect();
    var splitterSize = 4;
    var available, mousePos;
    if (isHoriz) {
      available = rect.width - splitterSize;
      mousePos = ev.clientX - rect.left;
    } else {
      available = rect.height - splitterSize;
      mousePos = ev.clientY - rect.top;
    }
    if (available < 40) return;
    var rawRatio = mousePos / (available + splitterSize);
    var ratio = Math.max(MIN_RATIO, Math.min(1 - MIN_RATIO, rawRatio));
    for (var i = 0; i < SNAP_POINTS.length; i++) {
      if (Math.abs(ratio - SNAP_POINTS[i]) < SNAP_THRESHOLD) {
        ratio = SNAP_POINTS[i];
        break;
      }
    }
    ST.setRatio(branchId, ratio);
    SL.updateRatios();
  };

  var onUp = function () {
    divider.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    triggerSave();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function initCornerDrag() {
  var dockRoot = document.getElementById('dockRoot');
  if (!dockRoot) return;

  dockRoot.addEventListener('mousedown', function (e) {
    var handle = e.target.closest('.corner-hotzone');
    if (!handle || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    startCornerDrag(handle, e);
  });
}

function startCornerDrag(handle, e) {
  var area = handle.closest('.split-area');
  if (!area) return;
  var leafId = area.dataset.nodeId;
  var corner = handle.dataset.corner;
  var startX = e.clientX;
  var startY = e.clientY;
  var determined = false;

  var onMove = function (ev) {
    var dx = ev.clientX - startX;
    var dy = ev.clientY - startY;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < DRAG_THRESHOLD) return;
    if (determined) return;
    determined = true;
    var action = determineCornerAction(corner, dx, dy);
    if (action.type === 'split') {
      showSplitPreview(area, action.direction, action.position);
    } else {
      var adjLeaf = ST.findAdjacentLeaf(leafId, action.joinDirection);
      if (adjLeaf) showJoinPreview(adjLeaf.id);
    }
  };

  var onUp = function (ev) {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    removeOverlays();
    if (!determined) return;

    var dx = ev.clientX - startX;
    var dy = ev.clientY - startY;
    var action = determineCornerAction(corner, dx, dy);

    if (action.type === 'split') {
      var areaRect = area.getBoundingClientRect();
      var ratio = action.direction === 'horizontal'
        ? (ev.clientX - areaRect.left) / areaRect.width
        : (ev.clientY - areaRect.top) / areaRect.height;
      ratio = Math.max(0.2, Math.min(0.8, ratio));
      ST.splitArea(leafId, action.direction, ratio);
      SL.render();
      triggerSave();
      return;
    }

    var adjLeaf = ST.findAdjacentLeaf(leafId, action.joinDirection);
    if (!adjLeaf) return;
    ST.joinAreas(leafId, adjLeaf.id);
    SL.render();
    triggerSave();
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function determineCornerAction(corner, dx, dy) {
  var isHoriz = Math.abs(dx) > Math.abs(dy);
  var inward, direction, joinDirection;

  if (corner === 'tl') {
    if (isHoriz) { inward = dx > 0; direction = 'horizontal'; joinDirection = 'left'; }
    else { inward = dy > 0; direction = 'vertical'; joinDirection = 'up'; }
  } else if (corner === 'tr') {
    if (isHoriz) { inward = dx < 0; direction = 'horizontal'; joinDirection = 'right'; }
    else { inward = dy > 0; direction = 'vertical'; joinDirection = 'up'; }
  } else if (corner === 'bl') {
    if (isHoriz) { inward = dx > 0; direction = 'horizontal'; joinDirection = 'left'; }
    else { inward = dy < 0; direction = 'vertical'; joinDirection = 'down'; }
  } else {
    if (isHoriz) { inward = dx < 0; direction = 'horizontal'; joinDirection = 'right'; }
    else { inward = dy < 0; direction = 'vertical'; joinDirection = 'down'; }
  }

  if (inward) return { type: 'split', direction: direction, position: corner };
  return { type: 'join', joinDirection: joinDirection };
}

function showSplitPreview(area, direction, position) {
  var overlay = document.createElement('div');
  overlay.className = 'split-preview-overlay';
  var preview = document.createElement('div');
  preview.className = 'split-preview-new';
  if (direction === 'horizontal') {
    preview.style.top = '0';
    preview.style.bottom = '0';
    preview.style.width = '50%';
    if (position === 'tl' || position === 'bl') preview.style.left = '0';
    else preview.style.right = '0';
  } else {
    preview.style.left = '0';
    preview.style.right = '0';
    preview.style.height = '50%';
    if (position === 'tl' || position === 'tr') preview.style.top = '0';
    else preview.style.bottom = '0';
  }
  overlay.appendChild(preview);
  area.appendChild(overlay);
}

function showJoinPreview(targetLeafId) {
  var targetArea = document.querySelector('.split-area[data-node-id="' + targetLeafId + '"]');
  if (!targetArea) return;
  var highlight = document.createElement('div');
  highlight.className = 'join-highlight';
  targetArea.appendChild(highlight);
}

function removeOverlays() {
  var overlays = document.querySelectorAll('.split-preview-overlay, .join-highlight');
  for (var i = 0; i < overlays.length; i++) overlays[i].remove();
}

function initContextMenu() {
  var dockRoot = document.getElementById('dockRoot');
  if (!dockRoot) return;

  dockRoot.addEventListener('contextmenu', function (e) {
    var divider = e.target.closest('.split-divider');
    if (!divider) return;
    e.preventDefault();
    showContextMenu(divider, e.clientX, e.clientY);
  });

  var menu = document.getElementById('splitContextMenu');
  if (!menu) return;
  menu.addEventListener('click', function (e) {
    var item = e.target.closest('.ctx-item');
    if (!item || item.classList.contains('disabled')) return;
    handleMenuAction(item.dataset.action);
    hideContextMenu();
  });

  document.addEventListener('click', function (e) {
    if (!e.target.closest('.split-context-menu')) hideContextMenu();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') hideContextMenu();
  });
}

function showContextMenu(divider, x, y) {
  var menu = document.getElementById('splitContextMenu');
  if (!menu) return;
  _menuBranchId = divider.dataset.branchId;
  var branch = ST.findNode(_menuBranchId);
  if (!branch) return;

  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('open');

  var c0 = branch.children[0];
  var c1 = branch.children[1];
  var isH = branch.direction === 'horizontal';
  var leaves = c0.type === 'leaf' && c1.type === 'leaf';

  setItemEnabled(menu, 'join-left', isH && leaves);
  setItemEnabled(menu, 'join-right', isH && leaves);
  setItemEnabled(menu, 'join-up', !isH && leaves);
  setItemEnabled(menu, 'join-down', !isH && leaves);
  setItemVisible(menu, 'join-left', isH);
  setItemVisible(menu, 'join-right', isH);
  setItemVisible(menu, 'join-up', !isH);
  setItemVisible(menu, 'join-down', !isH);
  setItemEnabled(menu, 'swap', leaves);
}

function hideContextMenu() {
  var menu = document.getElementById('splitContextMenu');
  if (menu) menu.classList.remove('open');
  _menuBranchId = null;
}

function setItemEnabled(menu, action, enabled) {
  var item = menu.querySelector('[data-action="' + action + '"]');
  if (item) item.classList.toggle('disabled', !enabled);
}

function setItemVisible(menu, action, visible) {
  var item = menu.querySelector('[data-action="' + action + '"]');
  if (item) item.style.display = visible ? '' : 'none';
}

function handleMenuAction(action) {
  if (!_menuBranchId) return;
  var branch = ST.findNode(_menuBranchId);
  if (!branch) return;
  var c0 = branch.children[0];
  var c1 = branch.children[1];

  switch (action) {
    case 'split-h':
      if (c0.type === 'leaf') ST.splitArea(c0.id, 'horizontal', 0.5);
      else if (c1.type === 'leaf') ST.splitArea(c1.id, 'horizontal', 0.5);
      break;
    case 'split-v':
      if (c0.type === 'leaf') ST.splitArea(c0.id, 'vertical', 0.5);
      else if (c1.type === 'leaf') ST.splitArea(c1.id, 'vertical', 0.5);
      break;
    case 'join-left':
    case 'join-up':
      if (c0.type === 'leaf' && c1.type === 'leaf') ST.joinAreas(c0.id, c1.id);
      break;
    case 'join-right':
    case 'join-down':
      if (c0.type === 'leaf' && c1.type === 'leaf') ST.joinAreas(c1.id, c0.id);
      break;
    case 'swap':
      if (c0.type === 'leaf' && c1.type === 'leaf') ST.swapAreas(c0.id, c1.id);
      break;
  }

  SL.render();
  triggerSave();
}

function initAreaCloseAndUndock() {
  var dockRoot = document.getElementById('dockRoot');
  if (!dockRoot) return;

  dockRoot.addEventListener('click', function (e) {
    var closeBtn = e.target.closest('.area-btn.close');
    if (closeBtn && !closeBtn.closest('.floating-panel')) {
      var area = closeBtn.closest('.split-area');
      if (!area) return;
      if (window._panels && window._panels.closeAreaByLeaf) {
        window._panels.closeAreaByLeaf(area.dataset.nodeId);
      }
      return;
    }

    var undockBtn = e.target.closest('.area-btn.undock');
    if (undockBtn && !undockBtn.closest('.floating-panel')) {
      var sourceArea = undockBtn.closest('.split-area');
      if (!sourceArea) return;
      if (window._panels && window._panels.undockLeaf) {
        window._panels.undockLeaf(sourceArea.dataset.nodeId);
      }
    }
  });
}

function initPanelSelectors() {
  var dockRoot = document.getElementById('dockRoot');
  if (!dockRoot) return;

  dockRoot.addEventListener('change', function (e) {
    var emptySelect = e.target.closest('.empty-panel-select');
    if (emptySelect) {
      var panelType = emptySelect.value;
      if (!panelType) return;
      var area = emptySelect.closest('.split-area');
      if (!area) return;
      if (window._panels && window._panels.assignLeafPanel) {
        window._panels.assignLeafPanel(area.dataset.nodeId, panelType);
      }
      return;
    }

    var areaSelect = e.target.closest('.area-panel-select');
    if (!areaSelect) return;
    var nextType = areaSelect.value;
    var areaEl = areaSelect.closest('.split-area');
    if (!areaEl) return;
    if (nextType === 'empty') {
      if (window._panels && window._panels.closeAreaByLeaf) {
        window._panels.closeAreaByLeaf(areaEl.dataset.nodeId);
      }
      return;
    }
    if (window._panels && window._panels.assignLeafPanel) {
      window._panels.assignLeafPanel(areaEl.dataset.nodeId, nextType);
    }
  });
}

function getDropPosition(targetArea, clientX, clientY) {
  var rect = targetArea.getBoundingClientRect();
  var xPad = Math.max(32, rect.width * 0.24);
  var yPad = Math.max(26, rect.height * 0.24);
  if (clientX < rect.left + xPad) return 'left';
  if (clientX > rect.right - xPad) return 'right';
  if (clientY < rect.top + yPad) return 'up';
  if (clientY > rect.bottom - yPad) return 'down';
  return 'center';
}

function clearAreaDropPreview() {
  var prev = document.querySelector('.area-drop-preview');
  if (prev) prev.remove();
}

function showAreaDropPreview(targetArea, position) {
  clearAreaDropPreview();
  var preview = document.createElement('div');
  preview.className = 'area-drop-preview area-drop-' + position;
  targetArea.appendChild(preview);
}

function initAreaHeaderDragDock() {
  var dockRoot = document.getElementById('dockRoot');
  if (!dockRoot) return;

  dockRoot.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (e.target.closest('.area-btn') || e.target.closest('.area-panel-select')) return;
    var header = e.target.closest('.area-header');
    if (!header) return;

    var sourceArea = header.closest('.split-area');
    if (!sourceArea) return;
    var sourceLeafId = sourceArea.dataset.nodeId;
    var sourceLeaf = ST.findNode(sourceLeafId);
    if (!sourceLeaf || sourceLeaf.type !== 'leaf' || sourceLeaf.panelType === 'empty') return;

    if (window._panelBus) window._panelBus.emit('panel:focused', { panelType: sourceLeaf.panelType, leafId: sourceLeafId });

    e.preventDefault();
    startAreaHeaderDrag(e, sourceLeafId, header);
  });
}

function startAreaHeaderDrag(startEvent, sourceLeafId, header) {
  var dragGhost = document.createElement('div');
  dragGhost.className = 'area-drag-ghost';
  var titleEl = header.querySelector('.area-title');
  dragGhost.textContent = titleEl ? titleEl.textContent : 'Panel';
  document.body.appendChild(dragGhost);

  var targetLeafId = null;
  var dropPos = null;
  var offsetX = 16;
  var offsetY = 12;

  var onMove = function (ev) {
    dragGhost.style.left = (ev.clientX + offsetX) + 'px';
    dragGhost.style.top = (ev.clientY + offsetY) + 'px';

    var hit = document.elementFromPoint(ev.clientX, ev.clientY);
    var area = hit ? hit.closest('.split-area') : null;
    if (!area || area.dataset.nodeId === sourceLeafId) {
      targetLeafId = null;
      dropPos = null;
      clearAreaDropPreview();
      return;
    }

    targetLeafId = area.dataset.nodeId;
    dropPos = getDropPosition(area, ev.clientX, ev.clientY);
    showAreaDropPreview(area, dropPos);
  };

  var onUp = function () {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    dragGhost.remove();
    clearAreaDropPreview();
    if (!targetLeafId || !dropPos) return;
    if (window._panels && window._panels.moveLeafToTarget) {
      window._panels.moveLeafToTarget(sourceLeafId, targetLeafId, dropPos);
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function initFloatingPanelControls() {
  document.addEventListener('click', function (e) {
    var actionBtn = e.target.closest('[data-float-action]');
    if (!actionBtn) return;
    var shell = actionBtn.closest('.floating-panel');
    if (!shell) return;
    var floatId = shell.dataset.floatId;
    var action = actionBtn.dataset.floatAction;
    if (!floatId || !window._panels) return;
    if (action === 'dock' && window._panels.redockFloating) {
      window._panels.redockFloating(floatId);
    } else if (action === 'close' && window._panels.closeFloating) {
      window._panels.closeFloating(floatId);
    }
  });

  document.addEventListener('mousedown', function (e) {
    if (e.button !== 0) return;
    if (e.target.closest('[data-float-action]')) return;
    var header = e.target.closest('.floating-header');
    if (!header) return;
    var shell = header.closest('.floating-panel');
    if (!shell) return;
    e.preventDefault();

    var rect = shell.getBoundingClientRect();
    var startX = e.clientX;
    var startY = e.clientY;
    var baseLeft = rect.left;
    var baseTop = rect.top;
    var floatId = shell.dataset.floatId;

    var onMove = function (ev) {
      var dx = ev.clientX - startX;
      var dy = ev.clientY - startY;
      shell.style.left = (baseLeft + dx) + 'px';
      shell.style.top = (baseTop + dy) + 'px';
    };

    var onUp = function () {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (window._panels && window._panels.updateFloatingRect) {
        window._panels.updateFloatingRect(floatId, {
          x: parseFloat(shell.style.left),
          y: parseFloat(shell.style.top)
        });
        triggerSave();
      }
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function init() {
  ST = window._splitTree;
  SL = window._splitLayout;
  if (!ST || !SL) {
    console.warn('[split-interact] dependencies not found');
    return;
  }
  initDividerResize();
  initCornerDrag();
  initContextMenu();
  initAreaCloseAndUndock();
  initPanelSelectors();
  initAreaHeaderDragDock();
  initFloatingPanelControls();

  // Emit panel:focused on any click within an area
  var dockRootEl = document.getElementById('dockRoot');
  if (dockRootEl) {
    dockRootEl.addEventListener('mousedown', function (e) {
      var area = e.target.closest('.split-area');
      if (!area) return;
      var leafId = area.dataset.nodeId;
      var leaf = ST.findNode(leafId);
      if (leaf && leaf.type === 'leaf' && leaf.panelType !== 'empty' && window._panelBus) {
        window._panelBus.emit('panel:focused', { panelType: leaf.panelType, leafId: leafId });
      }
    }, true); // capture phase so it fires before header drag prevents default
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

window._splitInteract = {
  hideContextMenu: hideContextMenu
};

})();

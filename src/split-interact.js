(function () {
'use strict';

var ST, SL; // references to _splitTree and _splitLayout
var MIN_RATIO = 0.05;
var SNAP_POINTS = [0.15, 0.2, 0.25, 0.333, 0.5, 0.667, 0.75, 0.8, 0.85];
var SNAP_THRESHOLD = 0.015;

// ═══════════════════════════════════════════════════════════════
// TASK 6: DIVIDER DRAG RESIZE
// ═══════════════════════════════════════════════════════════════

function initDividerResize() {
  // Use event delegation on dockRoot
  var dockRoot = document.getElementById('dockRoot');
  if (!dockRoot) return;

  dockRoot.addEventListener('mousedown', function (e) {
    var divider = e.target.closest('.split-divider');
    if (!divider) return;
    if (e.button !== 0) return; // left click only for drag
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

  // Find the container element (parent of the divider)
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

    // Snap to common ratios
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
    // Trigger autosave
    if (window._panels && window._panels.autoSaveLayout) {
      window._panels.autoSaveLayout();
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// ═══════════════════════════════════════════════════════════════
// TASK 7: CORNER-DRAG SPLIT/JOIN
// ═══════════════════════════════════════════════════════════════

var DRAG_THRESHOLD = 20; // px before we determine direction

function initCornerDrag() {
  var dockRoot = document.getElementById('dockRoot');
  if (!dockRoot) return;

  dockRoot.addEventListener('mousedown', function (e) {
    var handle = e.target.closest('.corner-hotzone');
    if (!handle) return;
    e.preventDefault();
    e.stopPropagation();
    startCornerDrag(handle, e);
  });
}

function startCornerDrag(handle, e) {
  var area = handle.closest('.split-area');
  if (!area) return;

  var leafId = area.dataset.nodeId;
  var corner = handle.dataset.corner; // 'tl','tr','bl','br'
  var startX = e.clientX;
  var startY = e.clientY;
  var determined = false;
  var overlay = null;

  var onMove = function (ev) {
    var dx = ev.clientX - startX;
    var dy = ev.clientY - startY;
    var dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < DRAG_THRESHOLD) return;

    if (!determined) {
      determined = true;
      var action = determineCornerAction(corner, dx, dy);

      if (action.type === 'split') {
        overlay = showSplitPreview(area, action.direction, action.position);
      } else if (action.type === 'join') {
        var adjLeaf = ST.findAdjacentLeaf(leafId, action.joinDirection);
        if (adjLeaf) {
          overlay = showJoinPreview(adjLeaf.id);
        }
      }
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
      // Calculate ratio from mouse position within area
      var areaRect = area.getBoundingClientRect();
      var ratio;
      if (action.direction === 'horizontal') {
        ratio = (ev.clientX - areaRect.left) / areaRect.width;
      } else {
        ratio = (ev.clientY - areaRect.top) / areaRect.height;
      }
      ratio = Math.max(0.2, Math.min(0.8, ratio));

      ST.splitArea(leafId, action.direction, ratio);
      SL.render();
      triggerSave();
    } else if (action.type === 'join') {
      var adjLeaf = ST.findAdjacentLeaf(leafId, action.joinDirection);
      if (adjLeaf) {
        ST.joinAreas(leafId, adjLeaf.id);
        SL.render();
        triggerSave();
      }
    }
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

function determineCornerAction(corner, dx, dy) {
  // Determine primary axis
  var isHoriz = Math.abs(dx) > Math.abs(dy);

  // Determine inward vs outward based on corner + direction
  // Inward = split, Outward = join
  var inward, direction, joinDirection;

  if (corner === 'tl') {
    if (isHoriz) {
      inward = dx > 0; // right is inward
      direction = 'horizontal';
      joinDirection = 'left';
    } else {
      inward = dy > 0; // down is inward
      direction = 'vertical';
      joinDirection = 'up';
    }
  } else if (corner === 'tr') {
    if (isHoriz) {
      inward = dx < 0; // left is inward
      direction = 'horizontal';
      joinDirection = 'right';
    } else {
      inward = dy > 0;
      direction = 'vertical';
      joinDirection = 'up';
    }
  } else if (corner === 'bl') {
    if (isHoriz) {
      inward = dx > 0;
      direction = 'horizontal';
      joinDirection = 'left';
    } else {
      inward = dy < 0; // up is inward
      direction = 'vertical';
      joinDirection = 'down';
    }
  } else { // br
    if (isHoriz) {
      inward = dx < 0;
      direction = 'horizontal';
      joinDirection = 'right';
    } else {
      inward = dy < 0;
      direction = 'vertical';
      joinDirection = 'down';
    }
  }

  if (inward) {
    return { type: 'split', direction: direction, position: corner };
  } else {
    return { type: 'join', joinDirection: joinDirection };
  }
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
    // Determine which side based on corner
    if (position === 'tl' || position === 'bl') {
      preview.style.left = '0';
    } else {
      preview.style.right = '0';
    }
  } else {
    preview.style.left = '0';
    preview.style.right = '0';
    preview.style.height = '50%';
    if (position === 'tl' || position === 'tr') {
      preview.style.top = '0';
    } else {
      preview.style.bottom = '0';
    }
  }

  overlay.appendChild(preview);
  area.appendChild(overlay);
  return overlay;
}

function showJoinPreview(targetLeafId) {
  var targetArea = document.querySelector('.split-area[data-node-id="' + targetLeafId + '"]');
  if (!targetArea) return null;
  var highlight = document.createElement('div');
  highlight.className = 'join-highlight';
  targetArea.appendChild(highlight);
  return highlight;
}

function removeOverlays() {
  var overlays = document.querySelectorAll('.split-preview-overlay, .join-highlight');
  for (var i = 0; i < overlays.length; i++) {
    overlays[i].remove();
  }
}

// ═══════════════════════════════════════════════════════════════
// TASK 8: RIGHT-CLICK CONTEXT MENU
// ═══════════════════════════════════════════════════════════════

var _menuBranchId = null;

function initContextMenu() {
  var dockRoot = document.getElementById('dockRoot');
  if (!dockRoot) return;

  // Right-click on divider
  dockRoot.addEventListener('contextmenu', function (e) {
    var divider = e.target.closest('.split-divider');
    if (!divider) return;
    e.preventDefault();
    showContextMenu(divider, e.clientX, e.clientY);
  });

  // Click on menu items
  var menu = document.getElementById('splitContextMenu');
  if (!menu) return;

  menu.addEventListener('click', function (e) {
    var item = e.target.closest('.ctx-item');
    if (!item || item.classList.contains('disabled')) return;
    var action = item.dataset.action;
    handleMenuAction(action);
    hideContextMenu();
  });

  // Close menu on click outside
  document.addEventListener('click', function (e) {
    if (!e.target.closest('.split-context-menu')) {
      hideContextMenu();
    }
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

  // Position menu
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.classList.add('open');

  // Enable/disable join items based on whether children are leaves
  var c0 = branch.children[0];
  var c1 = branch.children[1];
  var isH = branch.direction === 'horizontal';

  // Join left/up = keep child[0], remove child[1]
  // Join right/down = keep child[1], remove child[0]
  setItemEnabled(menu, 'join-left', isH && c0.type === 'leaf' && c1.type === 'leaf');
  setItemEnabled(menu, 'join-right', isH && c0.type === 'leaf' && c1.type === 'leaf');
  setItemEnabled(menu, 'join-up', !isH && c0.type === 'leaf' && c1.type === 'leaf');
  setItemEnabled(menu, 'join-down', !isH && c0.type === 'leaf' && c1.type === 'leaf');

  // Hide irrelevant join directions
  setItemVisible(menu, 'join-left', isH);
  setItemVisible(menu, 'join-right', isH);
  setItemVisible(menu, 'join-up', !isH);
  setItemVisible(menu, 'join-down', !isH);

  // Swap only works if both children are leaves
  setItemEnabled(menu, 'swap', c0.type === 'leaf' && c1.type === 'leaf');

  // Ensure menu stays on screen
  requestAnimationFrame(function () {
    var rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = (window.innerWidth - rect.width - 5) + 'px';
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = (window.innerHeight - rect.height - 5) + 'px';
    }
  });
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
      // Split the first child of this branch horizontally
      if (c0.type === 'leaf') {
        ST.splitArea(c0.id, 'horizontal', 0.5);
      } else if (c1.type === 'leaf') {
        ST.splitArea(c1.id, 'horizontal', 0.5);
      }
      break;
    case 'split-v':
      if (c0.type === 'leaf') {
        ST.splitArea(c0.id, 'vertical', 0.5);
      } else if (c1.type === 'leaf') {
        ST.splitArea(c1.id, 'vertical', 0.5);
      }
      break;
    case 'join-left':
    case 'join-up':
      // Keep first child, remove second
      if (c0.type === 'leaf' && c1.type === 'leaf') {
        ST.joinAreas(c0.id, c1.id);
      }
      break;
    case 'join-right':
    case 'join-down':
      // Keep second child, remove first
      if (c0.type === 'leaf' && c1.type === 'leaf') {
        ST.joinAreas(c1.id, c0.id);
      }
      break;
    case 'swap':
      if (c0.type === 'leaf' && c1.type === 'leaf') {
        ST.swapAreas(c0.id, c1.id);
      }
      break;
  }

  SL.render();
  triggerSave();
}

// ── Utility ────────────────────────────────────────────────────

function triggerSave() {
  if (window._panels && window._panels.autoSaveLayout) {
    window._panels.autoSaveLayout();
  }
}

// ── Init ───────────────────────────────────────────────────────

function init() {
  ST = window._splitTree;
  SL = window._splitLayout;
  if (!ST || !SL) {
    console.warn('[split-interact] Dependencies not found');
    return;
  }
  initDividerResize();
  initCornerDrag();
  initContextMenu();
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

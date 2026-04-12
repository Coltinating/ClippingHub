(function () {
'use strict';

// ── Node factory functions ──────────────────────────────────────────

var _idCounter = 0;
function _nextId(prefix) {
  return prefix + '_' + (++_idCounter).toString(36) + Math.random().toString(36).slice(2, 6);
}

function createLeaf(panelType) {
  return { type: 'leaf', id: _nextId('a'), panelType: panelType || 'empty' };
}

function createBranch(direction, ratio, childA, childB) {
  return {
    type: 'branch',
    id: _nextId('b'),
    direction: direction,
    ratio: Math.max(0.05, Math.min(0.95, ratio)),
    children: [childA, childB]
  };
}

// ── Tree traversal functions ────────────────────────────────────────

function findNode(root, id) {
  if (!root) return null;
  if (root.id === id) return root;
  if (root.type === 'branch') {
    return findNode(root.children[0], id) || findNode(root.children[1], id);
  }
  return null;
}

function findParent(root, id) {
  if (!root || root.type === 'leaf') return null;
  for (var i = 0; i < 2; i++) {
    if (root.children[i].id === id) return root;
    var found = findParent(root.children[i], id);
    if (found) return found;
  }
  return null;
}

function findSibling(root, id) {
  var parent = findParent(root, id);
  if (!parent) return null;
  return parent.children[0].id === id ? parent.children[1] : parent.children[0];
}

function getAllLeaves(node) {
  if (!node) return [];
  if (node.type === 'leaf') return [node];
  return getAllLeaves(node.children[0]).concat(getAllLeaves(node.children[1]));
}

function getLeafByPanelType(root, panelType) {
  var leaves = getAllLeaves(root);
  for (var i = 0; i < leaves.length; i++) {
    if (leaves[i].panelType === panelType) return leaves[i];
  }
  return null;
}

// ── Split/join/swap mutation functions ──────────────────────────────

function splitArea(root, leafId, direction, ratio) {
  ratio = ratio || 0.5;
  var parent = findParent(root, leafId);
  var leaf = findNode(root, leafId);
  if (!leaf || leaf.type !== 'leaf') return null;

  var newLeaf = createLeaf('empty');
  var newBranch = createBranch(direction, ratio, leaf, newLeaf);

  if (!parent) {
    return { newRoot: newBranch, newLeafId: newLeaf.id };
  }

  if (parent.children[0].id === leafId) {
    parent.children[0] = newBranch;
  } else {
    parent.children[1] = newBranch;
  }
  return { newRoot: root, newLeafId: newLeaf.id };
}

function joinAreas(root, keepLeafId, removeLeafId) {
  var parent = findParent(root, keepLeafId);
  if (!parent) return root;
  var isFirstKeep = parent.children[0].id === keepLeafId;
  var isSecondRemove = parent.children[1].id === removeLeafId;
  var isFirstRemove = parent.children[0].id === removeLeafId;
  var isSecondKeep = parent.children[1].id === keepLeafId;
  if (!(isFirstKeep && isSecondRemove) && !(isFirstRemove && isSecondKeep)) return root;

  var keepLeaf = findNode(root, keepLeafId);
  var grandparent = findParent(root, parent.id);

  if (!grandparent) {
    return keepLeaf;
  }

  if (grandparent.children[0].id === parent.id) {
    grandparent.children[0] = keepLeaf;
  } else {
    grandparent.children[1] = keepLeaf;
  }
  return root;
}

function swapAreas(root, leafIdA, leafIdB) {
  var a = findNode(root, leafIdA);
  var b = findNode(root, leafIdB);
  if (!a || !b || a.type !== 'leaf' || b.type !== 'leaf') return;
  var tmp = a.panelType;
  a.panelType = b.panelType;
  b.panelType = tmp;
}

function setRatio(root, branchId, newRatio) {
  var node = findNode(root, branchId);
  if (!node || node.type !== 'branch') return;
  node.ratio = Math.max(0.05, Math.min(0.95, newRatio));
}

// ── findAdjacentLeaf for join direction ─────────────────────────────

function findAdjacentLeaf(root, leafId, direction) {
  var axis = (direction === 'left' || direction === 'right') ? 'horizontal' : 'vertical';
  var needFirst = (direction === 'right' || direction === 'down');

  var currentId = leafId;
  var parent = findParent(root, currentId);

  while (parent) {
    if (parent.direction === axis) {
      var isInFirst = _isDescendant(parent.children[0], currentId);
      if (needFirst && isInFirst) {
        return _findEdgeLeaf(parent.children[1], direction);
      }
      if (!needFirst && !isInFirst) {
        return _findEdgeLeaf(parent.children[0], direction);
      }
    }
    currentId = parent.id;
    parent = findParent(root, currentId);
  }
  return null;
}

function _isDescendant(node, id) {
  if (node.id === id) return true;
  if (node.type === 'branch') {
    return _isDescendant(node.children[0], id) || _isDescendant(node.children[1], id);
  }
  return false;
}

function _findEdgeLeaf(node, direction) {
  if (node.type === 'leaf') return node;
  if (node.direction === 'horizontal') {
    if (direction === 'right' || direction === 'down') return _findEdgeLeaf(node.children[0], direction);
    return _findEdgeLeaf(node.children[1], direction);
  } else {
    if (direction === 'down' || direction === 'right') return _findEdgeLeaf(node.children[0], direction);
    return _findEdgeLeaf(node.children[1], direction);
  }
}

// ── Serialization, default tree, and module export ──────────────────

function serialize(root) {
  return JSON.parse(JSON.stringify(root));
}

function deserialize(json) {
  function walk(node) {
    if (node.type === 'leaf') {
      node.id = _nextId('a');
    } else {
      node.id = _nextId('b');
      walk(node.children[0]);
      walk(node.children[1]);
    }
    return node;
  }
  return walk(JSON.parse(JSON.stringify(json)));
}

var DEFAULT_TREE = {
  type: 'branch', id: 'b_root', direction: 'horizontal', ratio: 0.17,
  children: [
    { type: 'leaf', id: 'a_media', panelType: 'media' },
    { type: 'branch', id: 'b_cr', direction: 'horizontal', ratio: 0.77,
      children: [
        { type: 'branch', id: 'b_cv', direction: 'vertical', ratio: 0.75,
          children: [
            { type: 'leaf', id: 'a_preview', panelType: 'preview' },
            { type: 'leaf', id: 'a_timeline', panelType: 'timeline' }
          ]
        },
        { type: 'leaf', id: 'a_clips', panelType: 'clips' }
      ]
    }
  ]
};

var root = deserialize(DEFAULT_TREE);

var api = {
  getRoot: function () { return root; },
  setRoot: function (r) { root = r; },
  createLeaf: createLeaf,
  createBranch: createBranch,
  findNode: function (id) { return findNode(root, id); },
  findParent: function (id) { return findParent(root, id); },
  findSibling: function (id) { return findSibling(root, id); },
  findAdjacentLeaf: function (leafId, dir) { return findAdjacentLeaf(root, leafId, dir); },
  getAllLeaves: function () { return getAllLeaves(root); },
  getLeafByPanelType: function (pt) { return getLeafByPanelType(root, pt); },
  splitArea: function (leafId, dir, ratio) {
    var result = splitArea(root, leafId, dir, ratio);
    if (result) root = result.newRoot;
    return result;
  },
  joinAreas: function (keepId, removeId) { root = joinAreas(root, keepId, removeId); },
  swapAreas: function (a, b) { swapAreas(root, a, b); },
  setRatio: function (branchId, r) { setRatio(root, branchId, r); },
  serialize: function () { return serialize(root); },
  deserialize: function (json) { root = deserialize(json); return root; },
  DEFAULT_TREE: DEFAULT_TREE
};

if (typeof window !== 'undefined') window._splitTree = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;

})();

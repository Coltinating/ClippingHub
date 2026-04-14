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

function getProxyPort() {
  var state = window.Player && window.Player.state;
  return state && state.proxyPort ? state.proxyPort : null;
}

function toProxyUrl(url, proxyPort) {
  if (!proxyPort || !url) return '';
  var prefix = 'http://localhost:' + proxyPort + '/proxy?url=';
  if (url.indexOf(prefix) === 0) return url;
  return prefix + encodeURIComponent(url);
}

function destroyViewerInstance(key) {
  var inst = viewerInstances[key];
  if (!inst) return;
  if (window._panelLifecycle) window._panelLifecycle.notifyDestroy(key);
  if (inst.hls) {
    inst.hls.destroy();
    inst.hls = null;
  }
  if (inst.video) {
    inst.video.pause();
    inst.video.removeAttribute('src');
    inst.video.load();
  }
  delete viewerInstances[key];
}

function setViewerStatus(inst, text) {
  if (!inst || !inst.statusEl) return;
  inst.statusEl.textContent = text || '';
}

function syncViewerMute(inst) {
  if (!inst || !inst.video || !inst.muteBtn) return;
  inst.muteBtn.textContent = inst.video.muted ? 'Unmute' : 'Mute';
}

function loadViewerStream(inst, url) {
  if (!inst) return;
  var clean = String(url || '').trim();
  if (!clean) return;
  var proxyPort = getProxyPort();
  if (!proxyPort) {
    setViewerStatus(inst, 'Load clipper stream first');
    return;
  }
  if (inst.hls) {
    inst.hls.destroy();
    inst.hls = null;
  }
  inst.currentUrl = clean;
  if (inst.urlInput) inst.urlInput.value = clean;

  var video = inst.video;
  var proxied = toProxyUrl(clean, proxyPort);
  setViewerStatus(inst, 'Loading...');

  if (window.Hls && window.Hls.isSupported()) {
    var hls = new Hls({
      enableWorker: true,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      maxBufferSize: 40 * 1000 * 1000,
      liveSyncDurationCount: 3
    });
    inst.hls = hls;
    hls.loadSource(proxied);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, function () {
      setViewerStatus(inst, '');
      video.play().catch(function () {});
    });
    hls.on(Hls.Events.ERROR, function (_, data) {
      if (!data || !data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        hls.recoverMediaError();
      } else {
        setViewerStatus(inst, 'Viewer stream failed');
      }
    });
    return;
  }

  video.src = proxied;
  video.play().then(function () {
    setViewerStatus(inst, '');
  }).catch(function () {
    setViewerStatus(inst, 'Cannot autoplay');
  });
}

function createViewerPanel(instanceKey) {
  var panel = document.createElement('div');
  panel.className = 'panel viewer-panel';
  panel.dataset.viewerKey = instanceKey;

  var body = document.createElement('div');
  body.className = 'panel-body viewer-body';

  var viewport = document.createElement('div');
  viewport.className = 'viewer-video-wrap';
  var video = document.createElement('video');
  video.className = 'viewer-video';
  video.controls = true;
  video.playsInline = true;
  video.muted = true;
  viewport.appendChild(video);

  var status = document.createElement('div');
  status.className = 'viewer-status';
  status.textContent = 'No stream loaded';
  viewport.appendChild(status);

  var controls = document.createElement('div');
  controls.className = 'viewer-controls';

  var urlInput = document.createElement('input');
  urlInput.className = 'viewer-url';
  urlInput.type = 'text';
  urlInput.placeholder = 'Paste stream URL...';
  controls.appendChild(urlInput);

  var loadBtn = document.createElement('button');
  loadBtn.className = 'btn btn-primary btn-xs';
  loadBtn.textContent = 'Load';
  controls.appendChild(loadBtn);

  var followBtn = document.createElement('button');
  followBtn.className = 'btn btn-ghost btn-xs';
  followBtn.textContent = 'Follow Clipper';
  controls.appendChild(followBtn);

  var muteBtn = document.createElement('button');
  muteBtn.className = 'btn btn-ghost btn-xs';
  muteBtn.textContent = 'Unmute';
  controls.appendChild(muteBtn);

  body.appendChild(viewport);
  body.appendChild(controls);
  panel.appendChild(body);

  var inst = {
    key: instanceKey,
    el: panel,
    video: video,
    statusEl: status,
    urlInput: urlInput,
    loadBtn: loadBtn,
    followBtn: followBtn,
    muteBtn: muteBtn,
    currentUrl: '',
    hls: null
  };

  loadBtn.addEventListener('click', function () {
    loadViewerStream(inst, urlInput.value);
  });
  urlInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') loadViewerStream(inst, urlInput.value);
  });
  followBtn.addEventListener('click', function () {
    var state = window.Player && window.Player.state;
    if (!state || !state.currentM3U8) {
      setViewerStatus(inst, 'Clipper has no active stream');
      return;
    }
    loadViewerStream(inst, state.currentM3U8);
  });
  muteBtn.addEventListener('click', function () {
    video.muted = !video.muted;
    syncViewerMute(inst);
  });
  video.addEventListener('volumechange', function () {
    syncViewerMute(inst);
  });

  viewerInstances[instanceKey] = inst;
  return inst.el;
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

function getOrCreateFloatingRoot() {
  var root = document.getElementById('floatingPanelRoot');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'floatingPanelRoot';
  root.className = 'floating-panel-root';
  document.body.appendChild(root);
  return root;
}

function renderFloatingPanels(activeViewerKeys) {
  var root = getOrCreateFloatingRoot();
  root.innerHTML = '';

  var panelsApi = window._panels;
  var floating = panelsApi && panelsApi.getFloatingPanels ? panelsApi.getFloatingPanels() : [];
  for (var i = 0; i < floating.length; i++) {
    var item = floating[i];
    var panelType = normalizePanelType(item.panelType);

    var shell = document.createElement('div');
    shell.className = 'floating-panel';
    shell.dataset.floatId = item.id;
    shell.style.left = (item.x || 40) + 'px';
    shell.style.top = (item.y || 40) + 'px';
    shell.style.width = (item.width || 420) + 'px';
    shell.style.height = (item.height || 300) + 'px';

    var header = document.createElement('div');
    header.className = 'floating-header';
    header.innerHTML = '<span class="floating-title">' + getPanelTitle(panelType) + '</span>';
    var actions = document.createElement('div');
    actions.className = 'floating-actions';
    actions.innerHTML =
      '<button class="area-btn floating-dock" title="Dock" data-float-action="dock"><svg viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.1" fill="none"><rect x="2" y="3" width="8" height="6" rx="0.8"/><path d="M4 1.5h4"/></svg></button>' +
      '<button class="area-btn floating-close" title="Close" data-float-action="close"><svg viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.5" fill="none"><path d="M2 2l6 6M8 2l-6 6"/></svg></button>';
    header.appendChild(actions);
    shell.appendChild(header);

    var body = document.createElement('div');
    body.className = 'floating-body';
    var panelEl = null;
    if (panelType === 'viewer') {
      var key = 'float:' + item.id;
      activeViewerKeys.push(key);
      panelEl = getViewerPanel(key);
    } else {
      panelEl = getSharedPanelElement(panelType);
    }
    if (panelEl) {
      panelEl.style.display = '';
      body.appendChild(panelEl);
      if (window._panelLifecycle) window._panelLifecycle.notifyMount(panelType, panelEl, null, item.id);
    }
    shell.appendChild(body);
    root.appendChild(shell);
  }
}

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
    destroy: function (ctx) {
      if (ctx && ctx.instanceKey) destroyViewerInstance(ctx.instanceKey);
    },
    saveState: function () { return null; },
    restoreState: function () {}
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

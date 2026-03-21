(function () {
'use strict';

const logOutput = document.getElementById('logOutput');
const searchInput = document.getElementById('searchInput');
const searchCount = document.getElementById('searchCount');
const statusLeft = document.getElementById('statusLeft');
const statusRight = document.getElementById('statusRight');
const logPathBar = document.getElementById('logPathBar');
const debugApp = document.getElementById('debugApp');
const filterBar = document.getElementById('filterBar');

let allEntries = [];
let colorsOn = false;
let currentSearch = '';
let autoScroll = true;
const MAX_ENTRIES = 5000;

// ── Filter state (set of enabled categories) ─────────────
const ALL_CATEGORIES = ['ACTION', 'SESSION', 'STREAM', 'HLS', 'MARK', 'CLIP', 'FFMPEG', 'PROXY', 'UI', 'ERROR'];
const enabledFilters = new Set(ALL_CATEGORIES); // all on by default
const categoryCounts = {};
ALL_CATEGORIES.forEach(c => { categoryCounts[c] = 0; });

// ── Escaping ──────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Check if entry passes current filters ─────────────────
function passesFilter(entry) {
  return enabledFilters.has(entry.category);
}

// ── Render a single log line ──────────────────────────────
function createLogLine(entry) {
  const div = document.createElement('div');
  div.className = 'log-line';
  div.dataset.cat = entry.category;

  const timeStr = entry.ts ? entry.ts.slice(11, 23) : '';
  const dataStr = entry.data !== undefined ? ' ' + JSON.stringify(entry.data) : '';

  div.innerHTML =
    `<span class="log-ts">${esc(timeStr)}</span> ` +
    `<span class="log-cat log-cat-${esc(entry.category)}">[${esc(entry.category)}]</span> ` +
    `<span class="log-msg">${esc(entry.message)}</span>` +
    (dataStr ? ` <span class="log-data">${esc(dataStr)}</span>` : '');

  // Apply filter visibility
  if (!passesFilter(entry)) {
    div.classList.add('hidden');
  }

  // Apply search highlight
  if (currentSearch) {
    const text = (entry.message + dataStr).toLowerCase();
    if (text.includes(currentSearch)) {
      div.classList.add('search-hit');
    }
  }

  return div;
}

// ── Add entry ─────────────────────────────────────────────
function addEntry(entry) {
  allEntries.push(entry);
  if (allEntries.length > MAX_ENTRIES) {
    const removed = allEntries.shift();
    if (removed && categoryCounts[removed.category] !== undefined) {
      categoryCounts[removed.category]--;
    }
    if (logOutput.firstChild) logOutput.removeChild(logOutput.firstChild);
  }

  // Track count
  if (categoryCounts[entry.category] !== undefined) {
    categoryCounts[entry.category]++;
  } else {
    categoryCounts[entry.category] = 1;
  }

  const div = createLogLine(entry);
  logOutput.appendChild(div);

  if (autoScroll) {
    logOutput.scrollTop = logOutput.scrollHeight;
  }

  updateFilterCounts();
  updateStatus();
}

// ── Refilter all lines ────────────────────────────────────
function refilter() {
  const lines = logOutput.querySelectorAll('.log-line');
  let searchHitCount = 0;

  lines.forEach((div, i) => {
    const entry = allEntries[i];
    if (!entry) return;

    // Filter
    const filterMatch = passesFilter(entry);
    div.classList.toggle('hidden', !filterMatch);

    // Search
    if (currentSearch && filterMatch) {
      const text = (entry.message + (entry.data !== undefined ? ' ' + JSON.stringify(entry.data) : '')).toLowerCase();
      const hit = text.includes(currentSearch);
      div.classList.toggle('search-hit', hit);
      if (hit) searchHitCount++;
    } else {
      div.classList.remove('search-hit');
    }
  });

  searchCount.textContent = currentSearch ? `${searchHitCount} found` : '';
  updateStatus();
}

// ── Update filter button counts ───────────────────────────
function updateFilterCounts() {
  filterBar.querySelectorAll('.filter-btn').forEach(btn => {
    const cat = btn.dataset.cat;
    const countEl = btn.querySelector('.filter-count');
    if (countEl && categoryCounts[cat] !== undefined) {
      const c = categoryCounts[cat];
      countEl.textContent = c > 0 ? ` (${c})` : '';
    }
  });
}

// ── Update status bar ─────────────────────────────────────
function updateStatus() {
  const visibleLines = logOutput.querySelectorAll('.log-line:not(.hidden)').length;
  statusLeft.textContent = `${visibleLines} / ${allEntries.length} entries`;

  const activeCount = enabledFilters.size;
  if (activeCount === ALL_CATEGORIES.length) {
    statusRight.textContent = 'Showing: All';
  } else if (activeCount === 0) {
    statusRight.textContent = 'Showing: None';
  } else {
    statusRight.textContent = `Showing: ${[...enabledFilters].join(', ')}`;
  }
}

// ── Get visible text (for copy / save) ────────────────────
function getVisibleText() {
  const lines = [];
  logOutput.querySelectorAll('.log-line:not(.hidden)').forEach(div => {
    lines.push(div.textContent);
  });
  return lines.join('\n');
}

// ── Get active filter label for save filename ─────────────
function getFilterLabel() {
  if (enabledFilters.size === ALL_CATEGORIES.length) return 'All';
  if (enabledFilters.size === 0) return 'None';
  if (enabledFilters.size === 1) return [...enabledFilters][0];
  return [...enabledFilters].join('+');
}

// ═══════════════════════════════════════════════════════════
// ── Filter bar (Chrome DevTools style toggle buttons) ─────
// ═══════════════════════════════════════════════════════════

// Individual filter toggle
filterBar.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const cat = btn.dataset.cat;
    if (enabledFilters.has(cat)) {
      enabledFilters.delete(cat);
      btn.classList.remove('active');
    } else {
      enabledFilters.add(cat);
      btn.classList.add('active');
    }
    refilter();
  });
});

// Select All
document.getElementById('btnSelectAll').addEventListener('click', () => {
  ALL_CATEGORIES.forEach(c => enabledFilters.add(c));
  filterBar.querySelectorAll('.filter-btn').forEach(btn => btn.classList.add('active'));
  refilter();
});

// Deselect All
document.getElementById('btnDeselectAll').addEventListener('click', () => {
  enabledFilters.clear();
  filterBar.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
  refilter();
});

// ── Search input ──────────────────────────────────────────
let searchDebounce = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    currentSearch = searchInput.value.trim().toLowerCase();
    refilter();
  }, 150);
});

// ── Jump to bottom ────────────────────────────────────────
document.getElementById('btnJumpBottom').addEventListener('click', () => {
  logOutput.scrollTop = logOutput.scrollHeight;
  autoScroll = true;
});

// Detect manual scroll (disable auto-scroll when user scrolls up)
logOutput.addEventListener('scroll', () => {
  const atBottom = logOutput.scrollTop + logOutput.clientHeight >= logOutput.scrollHeight - 20;
  autoScroll = atBottom;
});

// ── Color toggle ──────────────────────────────────────────
const btnColors = document.getElementById('btnColors');
btnColors.addEventListener('click', () => {
  colorsOn = !colorsOn;
  debugApp.classList.toggle('colors-on', colorsOn);
  btnColors.classList.toggle('active', colorsOn);
});

// ── Copy to clipboard ─────────────────────────────────────
document.getElementById('btnCopy').addEventListener('click', () => {
  const text = getVisibleText();
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btnCopy');
    btn.style.color = 'var(--green)';
    setTimeout(() => { btn.style.color = ''; }, 1200);
  });
});

// ── Save output ───────────────────────────────────────────
document.getElementById('btnSave').addEventListener('click', async () => {
  const text = getVisibleText();
  const filterName = getFilterLabel();
  if (window.debugBridge?.saveLog) {
    await window.debugBridge.saveLog(text, filterName);
  }
});

// ── Listen for logs from main process ─────────────────────
if (window.debugBridge?.onLog) {
  window.debugBridge.onLog((entry) => {
    addEntry(entry);
  });
}

// ── Show log path ─────────────────────────────────────────
(async () => {
  if (window.debugBridge?.getLogPath) {
    const p = await window.debugBridge.getLogPath();
    logPathBar.textContent = 'Session log: ' + p;
  }
})();

// ═══════════════════════════════════════════════════════════
// ── Clip FFMPEG Log View ──────────────────────────────────
// ═══════════════════════════════════════════════════════════

const clipLogView = document.getElementById('clipLogView');
const clipLogContent = document.getElementById('clipLogContent');
const clipLogTitle = document.getElementById('clipLogTitle');
const clipLogBack = document.getElementById('clipLogBack');

// Normal debug view elements
const normalViewEls = [
  document.querySelector('.filter-bar'),
  document.querySelector('.log-path-bar'),
  logOutput,
];

function showClipLogView({ clipName, logData }) {
  clipLogTitle.textContent = `FFMPEG LOG — ${clipName}`;

  if (!logData) {
    clipLogContent.innerHTML = `
      <div class="clip-log-no-data">
        <p>No FFMPEG log data available for this clip.</p>
        <small>Logs are captured during download and stored for the current session only.</small>
      </div>`;
  } else {
    let html = '';

    // Meta info
    html += `<div class="clip-log-meta">Processed: ${esc(logData.timestamp)} &middot; Output: ${esc(logData.filePath)} &middot; Size: ${logData.fileSize ? ((logData.fileSize / 1048576).toFixed(1) + ' MB') : 'N/A'}</div>`;

    // Commands + logs
    if (logData.commands && logData.commands.length) {
      html += '<div class="clip-log-section"><div class="clip-log-section-title">FFmpeg Commands &amp; Output</div>';

      logData.commands.forEach((cmd, i) => {
        html += `<div class="clip-log-command"><span class="cmd-label">${esc(cmd.step)}</span>${esc(cmd.args)}</div>`;

        // Matching stderr log
        const stepLog = logData.logs && logData.logs[i];
        if (stepLog && stepLog.stderr && stepLog.stderr.trim()) {
          html += `<div class="clip-log-stderr">${esc(stepLog.stderr.trim())}</div>`;
        }
      });

      html += '</div>';
    }

    clipLogContent.innerHTML = html;
  }

  // Hide normal debug view, show clip log view
  normalViewEls.forEach(el => { if (el) el.style.display = 'none'; });
  clipLogView.style.display = 'flex';
}

function hideClipLogView() {
  clipLogView.style.display = 'none';
  normalViewEls.forEach(el => {
    if (el) el.style.display = '';
  });
}

clipLogBack.addEventListener('click', hideClipLogView);

// Listen for clip log view requests from main process
if (window.debugBridge?.onClipLogView) {
  window.debugBridge.onClipLogView((data) => {
    showClipLogView(data);
  });
}

// ── Keyboard shortcuts ────────────────────────────────────
document.addEventListener('keydown', (e) => {
  // Ctrl+F → focus search
  if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
  // Escape → close clip log view or clear search
  if (e.key === 'Escape') {
    if (clipLogView.style.display !== 'none') {
      hideClipLogView();
      return;
    }
    searchInput.value = '';
    currentSearch = '';
    refilter();
    searchInput.blur();
  }
});

})();

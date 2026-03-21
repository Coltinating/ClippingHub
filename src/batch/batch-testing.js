/* ═══════════════════════════════════════════════════════════════
   BATCH TESTING MODULE — FOR DEVELOPMENT PURPOSES
   Standalone renderer-side logic for batch/recursive testing.
   Remove this file + CSS + batch-ipc.js to fully disable.
   ═══════════════════════════════════════════════════════════════ */
(function () {
'use strict';

// ── Dependencies from renderer.js (exposed on window) ──────
function dbg(cat, msg, data) {
  if (window.dbg) window.dbg(cat, msg, data);
  else console.log(`[${cat}] ${msg}`, data || '');
}

// ── Default test config template ───────────────────────────
const DEFAULT_CFG = {
  videoCodec: 'libx264',
  preset: 'fast',
  crf: '18',
  audioCodec: 'aac',
  audioBitrate: '192k',
  hwaccel: '',
  hwaccelOutputFormat: '',
  hwaccelDevice: '',
  nvencPreset: 'p4',
};

// All options for each field
const OPTIONS = {
  videoCodec: [
    { value: 'libx264', label: 'libx264 (CPU)' },
    { value: 'libx265', label: 'libx265 (CPU)' },
    { value: 'h264_nvenc', label: 'h264_nvenc (NVIDIA)' },
    { value: 'hevc_nvenc', label: 'hevc_nvenc (NVIDIA)' },
  ],
  preset: [
    { value: 'ultrafast', label: 'ultrafast' },
    { value: 'superfast', label: 'superfast' },
    { value: 'veryfast', label: 'veryfast' },
    { value: 'faster', label: 'faster' },
    { value: 'fast', label: 'fast' },
    { value: 'medium', label: 'medium' },
    { value: 'slow', label: 'slow' },
    { value: 'slower', label: 'slower' },
    { value: 'veryslow', label: 'veryslow' },
  ],
  audioCodec: [
    { value: 'aac', label: 'AAC' },
    { value: 'libopus', label: 'Opus' },
    { value: 'copy', label: 'Copy (no re-encode)' },
  ],
  hwaccel: [
    { value: '', label: 'None (CPU only)' },
    { value: 'cuda', label: 'CUDA (NVIDIA)' },
    { value: 'd3d11va', label: 'D3D11VA (Windows)' },
    { value: 'dxva2', label: 'DXVA2 (Windows)' },
    { value: 'qsv', label: 'QSV (Intel)' },
  ],
  hwaccelOutputFormat: [
    { value: '', label: 'Default' },
    { value: 'cuda', label: 'cuda' },
    { value: 'd3d11', label: 'd3d11' },
  ],
  nvencPreset: [
    { value: 'p1', label: 'p1' }, { value: 'p2', label: 'p2' },
    { value: 'p3', label: 'p3' }, { value: 'p4', label: 'p4' },
    { value: 'p5', label: 'p5' }, { value: 'p6', label: 'p6' },
    { value: 'p7', label: 'p7' },
  ],
};

// ── State ──────────────────────────────────────────────────
let testSuite = [];
let suiteRunning = false;
let globalClipsPerTest = 5;
let globalNameScheme = 'test-clip';

// Positional testing state
let posMode = 'single';        // 'single' | 'multi'
let posDuration = 10;          // clip duration in seconds
let posTimestamps = [];         // array of seconds (start times)
let posPatternInterval = 5;    // every X minutes
let posPatternCount = 5;       // Y times

// ── Helpers ────────────────────────────────────────────────
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escA(s) { return String(s).replace(/"/g,'&quot;').replace(/</g,'&lt;'); }

function makeSelectHtml(name, options, selected, extraAttrs) {
  return `<select ${extraAttrs || ''} data-field="${name}">
    ${options.map(o => `<option value="${escA(o.value)}"${o.value === selected ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
  </select>`;
}

function cfgSummary(cfg) {
  const parts = [cfg.videoCodec, cfg.preset, 'crf' + cfg.crf, cfg.audioCodec, cfg.audioBitrate];
  if (cfg.hwaccel) parts.push('hw:' + cfg.hwaccel);
  return parts.join(' / ');
}

function cfgFolderName(cfg) {
  const parts = [cfg.videoCodec, cfg.preset, 'crf' + cfg.crf, cfg.audioCodec, cfg.audioBitrate];
  if (cfg.hwaccel) parts.push('hw-' + cfg.hwaccel);
  return parts.join('_');
}

function fmtHMSLocal(totalSec) {
  const s = Math.floor(Math.max(0, totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
}

function parseHMS(str) {
  const parts = str.trim().split(':').map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1 && !isNaN(parts[0])) return parts[0];
  return NaN;
}

function createTest(overrides) {
  return { id: Date.now().toString(36) + Math.random().toString(36).slice(2,5), cfg: { ...DEFAULT_CFG, ...overrides } };
}

// ── Get stream duration from the video element ─────────────
function getStreamDuration() {
  const vid = document.getElementById('vid');
  if (!vid) return 0;
  // For live: use seekable range
  if (vid.seekable && vid.seekable.length > 0) {
    return vid.seekable.end(vid.seekable.length - 1) - vid.seekable.start(0);
  }
  if (isFinite(vid.duration) && vid.duration > 0) return vid.duration;
  return 0;
}

// ── Generate timestamps from pattern ───────────────────────
function generatePattern(intervalMin, count, clipDurSec, maxDurSec) {
  const intervalSec = intervalMin * 60;
  // Auto-clamp count: ensure last clip fits within stream
  const maxPossible = Math.floor((maxDurSec - clipDurSec) / intervalSec) + 1;
  const clamped = Math.max(1, Math.min(count, maxPossible));
  const stamps = [];
  for (let i = 0; i < clamped; i++) {
    stamps.push(i * intervalSec);
  }
  return stamps;
}

// ═══════════════════════════════════════════════════════════
// ── Render the test suite modal ───────────────────────────
// ═══════════════════════════════════════════════════════════
function openTestSuiteModal(clip) {
  const old = document.querySelector('.batch-modal-overlay');
  if (old) old.remove();

  if (testSuite.length === 0) {
    testSuite.push(createTest());
  }

  const overlay = document.createElement('div');
  overlay.className = 'batch-modal-overlay';

  function getPositionCount() {
    if (posMode === 'single') return 1;
    return posTimestamps.length || 1;
  }

  function render() {
    const posCount = getPositionCount();
    const totalClips = testSuite.length * globalClipsPerTest * posCount;
    const streamDur = getStreamDuration();

    overlay.innerHTML = `
      <div class="batch-modal" style="width:760px;">
        <div class="batch-modal-header">
          <div>
            <span class="batch-modal-title">BATCH TEST SUITE</span>
            <span class="batch-modal-subtitle">(FOR DEVELOPMENT PURPOSES)</span>
          </div>
          <button class="batch-modal-close" id="batchSuiteClose">&times;</button>
        </div>

        <div class="batch-modal-body">

          <!-- Positional Testing -->
          <div class="batch-section" style="margin-bottom:12px;">
            <div class="batch-section-title">POSITION MODE</div>
            <div class="batch-pos-toggle">
              <button class="batch-pos-btn ${posMode==='single'?'active':''}" data-posmode="single">Single Position (use clip IN/OUT)</button>
              <button class="batch-pos-btn ${posMode==='multi'?'active':''}" data-posmode="multi">Multi-Position (test at multiple points)</button>
            </div>

            ${posMode === 'multi' ? `
              <div class="batch-pos-config">
                <div class="batch-pos-row">
                  <label class="batch-pos-field">
                    <span>Clip Duration (sec)</span>
                    <input type="number" id="batchPosDuration" value="${posDuration}" min="1" max="3600" class="batch-pos-input">
                  </label>
                  <span class="batch-pos-info">${streamDur > 0 ? 'Stream: ' + fmtHMSLocal(streamDur) + ' (' + Math.floor(streamDur) + 's)' : 'Stream duration unknown'}</span>
                </div>

                <!-- Pattern generator -->
                <div class="batch-pos-pattern">
                  <span class="batch-pos-pattern-label">Pattern</span>
                  <label>Every <input type="number" id="batchPatternInterval" value="${posPatternInterval}" min="1" max="999" class="batch-pos-input-sm"> min</label>
                  <label><input type="number" id="batchPatternCount" value="${posPatternCount}" min="1" max="999" class="batch-pos-input-sm"> times</label>
                  <button class="batch-pos-gen-btn" id="batchPatternGen">Generate</button>
                  ${streamDur > 0 ? `<span class="batch-pos-clamp-note">Max with this interval: ${Math.max(1, Math.floor((streamDur - posDuration) / (posPatternInterval * 60)) + 1)} positions</span>` : ''}
                </div>

                <!-- Manual timestamps -->
                <div class="batch-pos-stamps">
                  <div class="batch-pos-stamps-header">
                    <span>Timestamps (${posTimestamps.length})</span>
                    <button class="batch-pos-add-btn" id="batchPosAdd">+ Add</button>
                  </div>
                  <div class="batch-pos-stamp-list" id="batchPosStampList">
                    ${posTimestamps.length === 0 ? '<div class="batch-pos-empty">No timestamps — use the pattern generator or add manually</div>' : ''}
                    ${posTimestamps.map((ts, i) => `
                      <div class="batch-pos-stamp-row">
                        <span class="batch-pos-stamp-idx">#${i+1}</span>
                        <input type="text" class="batch-pos-stamp-input" data-stampidx="${i}" value="${fmtHMSLocal(ts)}" placeholder="HH:MM:SS">
                        <span class="batch-pos-stamp-range">→ ${fmtHMSLocal(ts + posDuration)}</span>
                        <button class="batch-pos-stamp-remove" data-stampremove="${i}">&times;</button>
                      </div>
                    `).join('')}
                  </div>
                </div>
              </div>
            ` : `
              <div class="batch-pos-single-info">Using clip IN: ${fmtHMSLocal(clip.inTime)} → OUT: ${fmtHMSLocal(clip.outTime)} (${Math.round(clip.outTime - clip.inTime)}s)</div>
            `}
          </div>

          <!-- Global settings -->
          <div class="batch-global">
            <label>Clips per position <input type="number" class="batch-global-num" id="batchGlobalCount" value="${globalClipsPerTest}" min="1" max="50"></label>
            <label>Name scheme <input type="text" class="batch-global-name" id="batchGlobalName" value="${escA(globalNameScheme)}" spellcheck="false"></label>
            <label style="margin-left:auto;color:#52525b;font-size:10px;">
              ${testSuite.length} config${testSuite.length===1?'':'s'} &times; ${posCount} pos &times; ${globalClipsPerTest} clips = <strong style="color:#a78bfa">${totalClips}</strong> total
            </label>
          </div>

          <!-- Test list -->
          <div class="batch-test-list" id="batchTestList">
            ${testSuite.map((test, idx) => `
              <div class="batch-test-card" data-idx="${idx}">
                <div class="batch-test-header">
                  <span class="batch-test-label">Config ${idx + 1}</span>
                  <span class="batch-test-summary">${esc(cfgSummary(test.cfg))}</span>
                  <button class="batch-test-remove" data-remove="${idx}" title="Remove">&times;</button>
                </div>
                <div class="batch-cfg-grid">
                  <div class="batch-cfg-field"><span>Video Codec</span>${makeSelectHtml('videoCodec', OPTIONS.videoCodec, test.cfg.videoCodec, `data-idx="${idx}"`)}</div>
                  <div class="batch-cfg-field"><span>Preset</span>${makeSelectHtml('preset', OPTIONS.preset, test.cfg.preset, `data-idx="${idx}"`)}</div>
                  <div class="batch-cfg-field"><span>CRF / CQ</span><input type="number" data-field="crf" data-idx="${idx}" value="${escA(test.cfg.crf)}" min="0" max="51"></div>
                  <div class="batch-cfg-field"><span>Audio Codec</span>${makeSelectHtml('audioCodec', OPTIONS.audioCodec, test.cfg.audioCodec, `data-idx="${idx}"`)}</div>
                  <div class="batch-cfg-field"><span>Audio Bitrate</span><input type="text" data-field="audioBitrate" data-idx="${idx}" value="${escA(test.cfg.audioBitrate)}"></div>
                  <div class="batch-cfg-field"><span>HW Accel</span>${makeSelectHtml('hwaccel', OPTIONS.hwaccel, test.cfg.hwaccel, `data-idx="${idx}"`)}</div>
                  <div class="batch-cfg-field"><span>HW Output Fmt</span>${makeSelectHtml('hwaccelOutputFormat', OPTIONS.hwaccelOutputFormat, test.cfg.hwaccelOutputFormat, `data-idx="${idx}"`)}</div>
                  <div class="batch-cfg-field"><span>HW Device</span><input type="text" data-field="hwaccelDevice" data-idx="${idx}" value="${escA(test.cfg.hwaccelDevice)}" placeholder="e.g. 0"></div>
                  <div class="batch-cfg-field"><span>NVENC Preset</span>${makeSelectHtml('nvencPreset', OPTIONS.nvencPreset, test.cfg.nvencPreset, `data-idx="${idx}"`)}</div>
                </div>
              </div>
            `).join('')}
            <button class="batch-add-btn" id="batchAddTest">+ Add Encoding Configuration</button>
          </div>

          <div id="batchProgressArea"></div>
        </div>

        <div class="batch-modal-footer">
          <div class="batch-footer-left">
            <button class="batch-add-btn" id="batchAddPresets" style="width:auto;padding:6px 12px;">+ All Presets</button>
            <button class="batch-add-btn" id="batchAddCodecs" style="width:auto;padding:6px 12px;">+ All Codecs</button>
            <button class="batch-add-btn" id="batchAddCrf" style="width:auto;padding:6px 12px;">+ CRF Sweep</button>
          </div>
          <div style="display:flex;gap:8px;align-items:center;">
            <span class="batch-footer-status" id="batchStatus">${totalClips} clips queued</span>
            <button class="batch-run-btn" id="batchRunAll" ${suiteRunning?'disabled':''}>Run Full Test</button>
          </div>
        </div>
      </div>
    `;

    wireEvents();
  }

  function wireEvents() {
    overlay.querySelector('#batchSuiteClose').onclick = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };

    // Position mode toggle
    overlay.querySelectorAll('[data-posmode]').forEach(btn => {
      btn.onclick = () => {
        posMode = btn.dataset.posmode;
        render();
      };
    });

    // Multi-position controls
    if (posMode === 'multi') {
      const durIn = overlay.querySelector('#batchPosDuration');
      if (durIn) durIn.onchange = function() { posDuration = Math.max(1, parseInt(this.value) || 10); render(); };

      const intIn = overlay.querySelector('#batchPatternInterval');
      if (intIn) intIn.onchange = function() { posPatternInterval = Math.max(1, parseInt(this.value) || 5); render(); };

      const cntIn = overlay.querySelector('#batchPatternCount');
      if (cntIn) cntIn.onchange = function() { posPatternCount = Math.max(1, parseInt(this.value) || 5); render(); };

      // Pattern generator
      const genBtn = overlay.querySelector('#batchPatternGen');
      if (genBtn) genBtn.onclick = () => {
        const streamDur = getStreamDuration();
        const maxDur = streamDur > 0 ? streamDur : 999999;
        posTimestamps = generatePattern(posPatternInterval, posPatternCount, posDuration, maxDur);
        dbg('ACTION', 'Batch: generated position pattern', { interval: posPatternInterval, requested: posPatternCount, actual: posTimestamps.length, timestamps: posTimestamps.map(fmtHMSLocal) });
        render();
      };

      // Add manual timestamp
      const addBtn = overlay.querySelector('#batchPosAdd');
      if (addBtn) addBtn.onclick = () => {
        const last = posTimestamps.length > 0 ? posTimestamps[posTimestamps.length - 1] + 60 : 0;
        posTimestamps.push(last);
        render();
      };

      // Edit timestamp
      overlay.querySelectorAll('.batch-pos-stamp-input').forEach(input => {
        input.onchange = function() {
          const idx = parseInt(this.dataset.stampidx);
          const sec = parseHMS(this.value);
          if (!isNaN(sec) && sec >= 0) {
            posTimestamps[idx] = sec;
            render();
          }
        };
      });

      // Remove timestamp
      overlay.querySelectorAll('[data-stampremove]').forEach(btn => {
        btn.onclick = () => {
          posTimestamps.splice(parseInt(btn.dataset.stampremove), 1);
          render();
        };
      });
    }

    // Global settings
    overlay.querySelector('#batchGlobalCount').onchange = function() {
      globalClipsPerTest = parseInt(this.value) || 5;
      render();
    };
    overlay.querySelector('#batchGlobalName').onchange = function() {
      globalNameScheme = this.value.trim() || 'test-clip';
    };

    // Config field changes
    overlay.querySelectorAll('[data-field]').forEach(el => {
      const handler = function() {
        const idx = parseInt(this.dataset.idx);
        const field = this.dataset.field;
        if (testSuite[idx]) {
          testSuite[idx].cfg[field] = this.value;
          const card = this.closest('.batch-test-card');
          if (card) {
            const summary = card.querySelector('.batch-test-summary');
            if (summary) summary.textContent = cfgSummary(testSuite[idx].cfg);
          }
          updateStatus();
        }
      };
      el.onchange = handler;
      el.oninput = handler;
    });

    // Remove test
    overlay.querySelectorAll('[data-remove]').forEach(btn => {
      btn.onclick = () => {
        testSuite.splice(parseInt(btn.dataset.remove), 1);
        render();
      };
    });

    // Add test
    overlay.querySelector('#batchAddTest').onclick = () => {
      const base = testSuite.length > 0 ? { ...testSuite[testSuite.length - 1].cfg } : {};
      testSuite.push(createTest(base));
      render();
    };

    // Quick-add buttons
    overlay.querySelector('#batchAddPresets').onclick = () => {
      const base = testSuite.length > 0 ? testSuite[testSuite.length - 1].cfg : DEFAULT_CFG;
      OPTIONS.preset.forEach(p => testSuite.push(createTest({ ...base, preset: p.value })));
      render();
      dbg('ACTION', 'Batch: added preset comparison');
    };
    overlay.querySelector('#batchAddCodecs').onclick = () => {
      const base = testSuite.length > 0 ? testSuite[testSuite.length - 1].cfg : DEFAULT_CFG;
      OPTIONS.videoCodec.forEach(c => testSuite.push(createTest({ ...base, videoCodec: c.value })));
      render();
      dbg('ACTION', 'Batch: added codec comparison');
    };
    overlay.querySelector('#batchAddCrf').onclick = () => {
      const base = testSuite.length > 0 ? testSuite[testSuite.length - 1].cfg : DEFAULT_CFG;
      [14, 16, 18, 20, 22, 24, 26].forEach(crf => testSuite.push(createTest({ ...base, crf: String(crf) })));
      render();
      dbg('ACTION', 'Batch: added CRF sweep');
    };

    // Run
    overlay.querySelector('#batchRunAll').onclick = () => {
      if (suiteRunning) return;
      if (posMode === 'multi' && posTimestamps.length === 0) {
        alert('Add at least one timestamp or generate a pattern first.');
        return;
      }
      runFullTest(clip, overlay);
    };

    updateStatus();
  }

  function updateStatus() {
    const posCount = getPositionCount();
    const totalClips = testSuite.length * globalClipsPerTest * posCount;
    const status = overlay.querySelector('#batchStatus');
    if (status) status.textContent = `${testSuite.length} configs, ${posCount} pos, ${totalClips} clips`;
  }

  render();
  document.body.appendChild(overlay);
}

// ═══════════════════════════════════════════════════════════
// ── Run the full test suite (detached progress window) ────
// ═══════════════════════════════════════════════════════════
async function runFullTest(clip, overlay) {
  if (suiteRunning) return;
  suiteRunning = true;

  // Build position list
  let positions;
  if (posMode === 'multi') {
    positions = posTimestamps.map(ts => ({
      startSec: ts,
      durationSec: posDuration,
      label: fmtHMSLocal(ts) + '_' + posDuration + 's',
    }));
  } else {
    const startSec = clip.inTime - (clip.seekableStart || 0);
    positions = [{
      startSec: Math.max(0, startSec),
      durationSec: clip.outTime - clip.inTime,
      label: fmtHMSLocal(clip.inTime) + '_' + Math.round(clip.outTime - clip.inTime) + 's',
    }];
  }

  const totalClips = testSuite.length * positions.length * globalClipsPerTest;
  const startTime = Date.now();
  let completed = 0;

  dbg('ACTION', 'Batch: starting full test run', {
    configs: testSuite.length,
    positions: positions.length,
    clipsPerPos: globalClipsPerTest,
    totalClips,
    posMode,
  });

  await window.clipper.openBatchProgress();
  overlay.remove();

  window.clipper.sendBatchProgress({
    type: 'start',
    totalTests: testSuite.length,
    totalPositions: positions.length,
    totalClips,
    clipsPerTest: globalClipsPerTest,
    posMode,
  });

  for (let t = 0; t < testSuite.length; t++) {
    const test = testSuite[t];
    const folderName = cfgFolderName(test.cfg);
    const summary = cfgSummary(test.cfg);

    window.clipper.sendBatchProgress({
      type: 'test-start',
      testIndex: t + 1,
      totalTests: testSuite.length,
      configSummary: summary,
    });

    for (let p = 0; p < positions.length; p++) {
      const pos = positions[p];

      if (positions.length > 1) {
        window.clipper.sendBatchProgress({
          type: 'position-start',
          posIndex: p + 1,
          totalPositions: positions.length,
          posLabel: pos.label,
          testIndex: t + 1,
        });
      }

      for (let c = 0; c < globalClipsPerTest; c++) {
        // Name: scheme-t{config}-{position}-{copy}
        const posTag = positions.length > 1 ? `-${pos.label}` : '';
        const clipName = `${globalNameScheme}-cfg${t + 1}${posTag}-${c + 1}`;

        window.clipper.sendBatchProgress({
          type: 'clip-start',
          testIndex: t + 1,
          totalTests: testSuite.length,
          clipIndex: c + 1,
          clipsPerTest: globalClipsPerTest,
          posIndex: p + 1,
          posLabel: pos.label,
          clipName,
        });

        try {
          dbg('CLIP', `Batch: cfg${t+1} pos${p+1} clip${c+1}`, { clipName, config: summary, pos: pos.label });

          const result = await window.clipper.downloadClip({
            m3u8Url: clip.m3u8Url,
            startSec: pos.startSec,
            durationSec: pos.durationSec,
            clipName,
            watermark: null,
            outro: null,
            ffmpegOptions: { ...test.cfg },
            batchOutputDir: folderName,
            batchManifest: {
              batchId: test.id,
              batchIndex: c + 1,
              batchTotal: globalClipsPerTest,
              testIndex: t + 1,
              testTotal: testSuite.length,
              positionIndex: p + 1,
              positionTotal: positions.length,
              positionLabel: pos.label,
              startSec: pos.startSec,
              durationSec: pos.durationSec,
              ffmpegConfig: { ...test.cfg },
              hasWatermark: false,
              hasOutro: false,
            },
          });

          completed++;
          const sizeStr = result?.fileSize ? (result.fileSize / 1048576).toFixed(1) + ' MB' : '?';
          dbg('CLIP', `Batch clip done: ${clipName}`, { fileSize: result?.fileSize });

          window.clipper.sendBatchProgress({
            type: 'clip-done', clipName, fileSize: sizeStr, completed, totalClips,
          });
        } catch (err) {
          completed++;
          dbg('ERROR', `Batch clip failed: ${clipName}`, { error: err.message });

          window.clipper.sendBatchProgress({
            type: 'clip-fail', clipName, error: err.message, completed, totalClips,
          });
        }
      }
    }
  }

  const elapsedSec = Math.round((Date.now() - startTime) / 1000);
  const mins = Math.floor(elapsedSec / 60);
  const secs = elapsedSec % 60;
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  const clipsDir = await window.clipper.getClipsDir();

  window.clipper.sendBatchProgress({
    type: 'complete',
    totalTests: testSuite.length,
    totalClips,
    elapsed: elapsedStr,
    outputFolder: clipsDir + '/_batch',
  });

  suiteRunning = false;
  dbg('ACTION', 'Batch: full test run complete', { configs: testSuite.length, positions: positions.length, totalClips, elapsed: elapsedStr });
}

// ── Expose to global scope ─────────────────────────────────
window._batchTesting = {
  openTestSuiteModal,
  get enabled() { return typeof batchModeEnabled !== 'undefined' ? batchModeEnabled : false; },
};

})();

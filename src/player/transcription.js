/**
 * Player Transcription — live speech-to-text using Whisper.
 *
 * Two backends:
 *   CPU  — WASM Whisper via @xenova/transformers in a Web Worker (default)
 *   GPU  — Native whisper.cpp with CUDA via IPC to main process
 *
 * Public API (on window.Player.transcription):
 *   toggle()            — start / stop live transcription
 *   start()             — begin transcription (loads model on first call)
 *   stop()              — stop transcription and audio capture
 *   reset()             — stop, hide panel, clear transcript
 *   clear()             — clear the transcript panel
 *   isActive()          — returns true while transcribing
 *   setBackend(b)       — 'cpu' or 'gpu', takes effect on next start()
 *   getBackend()        — returns current backend string
 *   exportTranscript()  — download transcript as .txt
 *   search(query)       — filter/highlight transcript lines
 */
(function () {
  'use strict';

  var P = window.Player;
  var log = function (msg, data) { P.log('PLAYER:TRANSCRIPTION', msg, data); };

  /* ── Constants ────────────────────────────────────────────── */
  var TARGET_SR = 16000;
  var CHUNK_SECONDS_CPU = 5;
  var CHUNK_SECONDS_GPU = 15;       // whisper.cpp: longer = fewer dupes (cold start per chunk)
  var CHUNK_SECONDS_FASTER = 5;     // faster-whisper: model stays loaded, can go short for low latency
  var BUFFER_SIZE = 4096;
  var RING_CAPACITY = 0;

  /* ── Internal state ───────────────────────────────────────── */
  var backend = 'cpu';            // 'cpu' | 'gpu' | 'faster'
  var worker = null;              // CPU backend Web Worker
  var modelReady = false;         // CPU model loaded?
  var modelLoading = false;
  var gpuAvailable = null;        // null = not checked, true/false after check
  var fasterAvailable = null;
  var active = false;
  var audioCtx = null;
  var sourceNode = null;
  var processorNode = null;
  var silentGain = null;
  var chunkId = 0;
  var pendingChunks = 0;

  // Ring buffer
  var ringBuf = null;
  var ringWrite = 0;

  // Transcript data
  var lines = [];
  var searchQuery = '';
  var lastGpuText = '';              // for cross-chunk deduplication

  /* ── DOM refs ─────────────────────────────────────────────── */
  var panelEl, bodyEl, statusEl, toggleBtn, searchInput, exportBtn;
  var dropdownEl, cpuOption, gpuOption, fasterOption, gpuUnavailableEl, fasterUnavailableEl;

  /* ── Helpers ──────────────────────────────────────────────── */

  function downsample(buffer, len, srcRate) {
    if (srcRate === TARGET_SR) return buffer.slice(0, len);
    var ratio = srcRate / TARGET_SR;
    var newLen = Math.round(len / ratio);
    var out = new Float32Array(newLen);
    for (var i = 0; i < newLen; i++) {
      var idx = i * ratio;
      var lo = Math.floor(idx);
      var hi = lo + 1 < len ? lo + 1 : lo;
      var frac = idx - lo;
      out[i] = buffer[lo] + (buffer[hi] - buffer[lo]) * frac;
    }
    return out;
  }

  /**
   * Remove overlapping text between consecutive GPU chunks.
   * Compares the tail words of the previous result with the head words of the
   * new result and strips the longest common overlap.
   */
  function deduplicateGpu(text) {
    if (!lastGpuText) { lastGpuText = text; return text; }
    var prevWords = lastGpuText.split(/\s+/);
    var newWords = text.split(/\s+/);
    // Try matching the last N words of prev with the first N words of new (max 8)
    var maxCheck = Math.min(8, prevWords.length, newWords.length);
    var bestOverlap = 0;
    for (var n = 1; n <= maxCheck; n++) {
      var tailSlice = prevWords.slice(-n).join(' ').toLowerCase();
      var headSlice = newWords.slice(0, n).join(' ').toLowerCase();
      if (tailSlice === headSlice) bestOverlap = n;
    }
    var deduped = bestOverlap > 0 ? newWords.slice(bestOverlap).join(' ') : text;
    lastGpuText = text;
    return deduped.trim();
  }

  /** Convert Float32 [-1,1] to Int16 PCM Buffer for GPU backend. */
  function float32ToInt16Buffer(float32) {
    var buf = new ArrayBuffer(float32.length * 2);
    var view = new DataView(buf);
    for (var i = 0; i < float32.length; i++) {
      var s = Math.max(-1, Math.min(1, float32[i]));
      view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buf;
  }

  /* ── CPU Worker management ────────────────────────────────── */

  function ensureWorker() {
    if (worker) return;
    log('Creating CPU transcription worker');
    worker = new Worker('transcription-worker.js', { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = function (err) {
      log('Worker error', { message: err.message });
      setStatus('error', 'Worker error');
    };
  }

  function onWorkerMessage(e) {
    var msg = e.data;
    if (msg.type === 'status') {
      log('Worker status', { status: msg.status });
      if (msg.status === 'ready') {
        modelReady = true;
        modelLoading = false;
        setStatus('ready', 'Listening...');
        if (active) startCapture();
      } else if (msg.status === 'loading') {
        setStatus('loading', 'Loading model...');
      } else if (msg.status === 'error') {
        modelLoading = false;
        setStatus('error', 'Model failed to load');
      }
    } else if (msg.type === 'progress') {
      setStatus('loading', 'Downloading model... ' + msg.progress + '%');
    } else if (msg.type === 'result') {
      pendingChunks = Math.max(0, pendingChunks - 1);
      if (msg.text && msg.text.length > 0) addLine(msg.time, msg.text);
      if (active && pendingChunks === 0) setStatus('ready', 'Listening...');
    } else if (msg.type === 'error') {
      pendingChunks = Math.max(0, pendingChunks - 1);
      log('Transcription error', { error: msg.error, id: msg.id });
    }
  }

  /* ── GPU backend (whisper.cpp via IPC) ────────────────────── */

  function sendToGpu(resampled, timestamp) {
    var pcmBuf = float32ToInt16Buffer(resampled);
    var id = ++chunkId;
    pendingChunks++;
    setStatus('busy', 'Transcribing (GPU)...');

    window.clipper.transcribeGpu({ audioBuffer: pcmBuf }).then(function (res) {
      pendingChunks = Math.max(0, pendingChunks - 1);
      if (res.error) {
        log('GPU transcription error', { error: res.error });
        if (active && pendingChunks === 0) setStatus('ready', 'Listening...');
        return;
      }
      var raw = (res.text || '').trim();
      var text = deduplicateGpu(raw);
      if (text.length > 0) addLine(timestamp, text);
      if (active && pendingChunks === 0) setStatus('ready', 'Listening...');
    }).catch(function (err) {
      pendingChunks = Math.max(0, pendingChunks - 1);
      log('GPU IPC error', { error: err.message });
    });
  }

  /* ── faster-whisper backend (Python via IPC) ─────────────── */

  function sendToFaster(resampled, timestamp) {
    var pcmBuf = float32ToInt16Buffer(resampled);
    var id = ++chunkId;
    pendingChunks++;
    setStatus('busy', 'Transcribing (Faster)...');

    window.clipper.transcribeFaster({ audioBuffer: pcmBuf }).then(function (res) {
      pendingChunks = Math.max(0, pendingChunks - 1);
      if (res.error) {
        log('faster-whisper error', { error: res.error });
        if (active && pendingChunks === 0) setStatus('ready', 'Listening (Faster)...');
        return;
      }
      var raw = (res.text || '').trim();
      var text = deduplicateGpu(raw);  // same dedup logic applies
      if (text.length > 0) addLine(timestamp, text);
      if (active && pendingChunks === 0) setStatus('ready', 'Listening (Faster)...');
    }).catch(function (err) {
      pendingChunks = Math.max(0, pendingChunks - 1);
      log('faster-whisper IPC error', { error: err.message });
    });
  }

  /* ── Audio capture ────────────────────────────────────────── */

  function startCapture() {
    var vid = P.els.vid;
    if (!vid || (!vid.srcObject && !vid.src && !vid.currentSrc)) {
      log('No video source — cannot capture audio');
      setStatus('error', 'No video loaded');
      return;
    }

    try {
      var stream = vid.captureStream ? vid.captureStream() : vid.mozCaptureStream();
      var audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        log('No audio tracks in captured stream');
        setStatus('error', 'No audio track');
        return;
      }

      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      var audioStream = new MediaStream([audioTracks[0]]);
      sourceNode = audioCtx.createMediaStreamSource(audioStream);
      processorNode = audioCtx.createScriptProcessor(BUFFER_SIZE, 1, 1);
      silentGain = audioCtx.createGain();
      silentGain.gain.value = 0;

      sourceNode.connect(processorNode);
      processorNode.connect(silentGain);
      silentGain.connect(audioCtx.destination);

      var chunkSec = backend === 'faster' ? CHUNK_SECONDS_FASTER
                   : backend === 'gpu'    ? CHUNK_SECONDS_GPU
                   :                        CHUNK_SECONDS_CPU;
      RING_CAPACITY = Math.ceil(audioCtx.sampleRate * chunkSec);
      ringBuf = new Float32Array(RING_CAPACITY + BUFFER_SIZE);
      ringWrite = 0;

      processorNode.onaudioprocess = function (e) {
        if (!active) return;
        var input = e.inputBuffer.getChannelData(0);
        ringBuf.set(input, ringWrite);
        ringWrite += input.length;
        if (ringWrite >= RING_CAPACITY) flushRing(audioCtx.sampleRate);
      };

      log('Audio capture started', { sampleRate: audioCtx.sampleRate, backend: backend });
    } catch (err) {
      log('Failed to start audio capture', { error: err.message });
      setStatus('error', 'Audio capture failed');
    }
  }

  function stopCapture() {
    if (processorNode) { processorNode.onaudioprocess = null; processorNode.disconnect(); processorNode = null; }
    if (sourceNode) { sourceNode.disconnect(); sourceNode = null; }
    if (silentGain) { silentGain.disconnect(); silentGain = null; }
    if (audioCtx) { audioCtx.close().catch(function () {}); audioCtx = null; }
    ringBuf = null;
    ringWrite = 0;
    log('Audio capture stopped');
  }

  function flushRing(srcRate) {
    var len = ringWrite;
    ringWrite = 0;
    if (len === 0) return;

    // Silence check (sample every 16th)
    var sum = 0, step = 16, count = 0;
    for (var i = 0; i < len; i += step) { sum += ringBuf[i] * ringBuf[i]; count++; }
    var rms = Math.sqrt(sum / count);
    if (rms < 0.005) { log('Skipping silent chunk', { rms: rms.toFixed(6) }); return; }

    var resampled = downsample(ringBuf, len, srcRate);
    var timestamp = P.els.vid ? P.els.vid.currentTime : 0;

    if (backend === 'faster') {
      sendToFaster(resampled, timestamp);
    } else if (backend === 'gpu') {
      sendToGpu(resampled, timestamp);
    } else {
      var id = ++chunkId;
      pendingChunks++;
      setStatus('busy', 'Transcribing...');
      worker.postMessage(
        { type: 'transcribe', audio: resampled, id: id, time: timestamp },
        [resampled.buffer]
      );
    }
  }

  /* ── Transcript data ──────────────────────────────────────── */

  function addLine(time, text) {
    if (lines.length > 0 && lines[lines.length - 1].text === text) return;
    lines.push({ time: time, text: text });
    renderLine(lines.length - 1);
  }

  /* ── UI helpers ───────────────────────────────────────────── */

  function setStatus(type, text) {
    if (!statusEl) return;
    statusEl.className = 'transcript-status ' + type;
    statusEl.textContent = text;
  }

  function renderLine(idx) {
    if (!bodyEl) return;
    var entry = lines[idx];
    var q = searchQuery.toLowerCase();
    if (q && entry.text.toLowerCase().indexOf(q) === -1) return;

    var empty = bodyEl.querySelector('.transcript-empty');
    if (empty) empty.remove();

    var line = document.createElement('div');
    line.className = 'transcript-line';
    line.dataset.idx = idx;

    var timeEl = document.createElement('button');
    timeEl.className = 'transcript-time';
    timeEl.textContent = P.utils.fmtDur(entry.time);
    timeEl.title = 'Jump to ' + P.utils.fmtDur(entry.time);
    timeEl.dataset.time = entry.time;
    timeEl.onclick = onTimestampClick;

    var contentEl = document.createElement('span');
    contentEl.className = 'transcript-text';
    if (q) {
      contentEl.innerHTML = highlightMatch(entry.text, q);
    } else {
      contentEl.textContent = entry.text;
    }

    line.appendChild(timeEl);
    line.appendChild(contentEl);
    bodyEl.appendChild(line);

    var atBottom = bodyEl.scrollHeight - bodyEl.scrollTop - bodyEl.clientHeight < 60;
    if (atBottom) bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function renderAllLines() {
    if (!bodyEl) return;
    bodyEl.innerHTML = '';
    if (lines.length === 0) {
      bodyEl.innerHTML = '<div class="transcript-empty">Transcript lines will appear here...</div>';
      return;
    }
    var anyVisible = false;
    for (var i = 0; i < lines.length; i++) {
      var before = bodyEl.childElementCount;
      renderLine(i);
      if (bodyEl.childElementCount > before) anyVisible = true;
    }
    if (!anyVisible) {
      bodyEl.innerHTML = '<div class="transcript-empty">No matches found</div>';
    }
  }

  function highlightMatch(text, query) {
    var lower = text.toLowerCase();
    var idx = lower.indexOf(query);
    if (idx === -1) return escapeHtml(text);
    return escapeHtml(text.slice(0, idx))
      + '<mark class="transcript-highlight">' + escapeHtml(text.slice(idx, idx + query.length)) + '</mark>'
      + highlightMatch(text.slice(idx + query.length), query);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function onTimestampClick(e) {
    var time = parseFloat(e.currentTarget.dataset.time);
    if (isNaN(time)) return;
    var vid = P.els.vid;
    if (!vid) return;
    if (P.state.isLive) {
      vid.currentTime = P.live.clampLive(time);
    } else {
      vid.currentTime = Math.max(0, Math.min(vid.duration || Infinity, time));
    }
    log('Timestamp clicked — seeking', { time: time });
  }

  function showPanel(show) {
    if (panelEl) panelEl.style.display = show ? 'flex' : 'none';
  }

  /* ── Search ───────────────────────────────────────────────── */

  function onSearchInput(e) {
    searchQuery = (e.target.value || '').trim();
    renderAllLines();
  }

  /* ── Export ────────────────────────────────────────────────── */

  function exportTranscript() {
    if (lines.length === 0) return;
    var text = lines.map(function (l) {
      return '[' + P.utils.fmtDur(l.time) + '] ' + l.text;
    }).join('\n');

    var blob = new Blob([text], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'transcript_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log('Transcript exported', { lines: lines.length });
  }

  /* ── Dropdown menu ────────────────────────────────────────── */

  function updateDropdownUI() {
    if (!cpuOption || !gpuOption) return;
    cpuOption.classList.toggle('selected', backend === 'cpu');
    gpuOption.classList.toggle('selected', backend === 'gpu');
    if (fasterOption) fasterOption.classList.toggle('selected', backend === 'faster');
    if (gpuUnavailableEl) {
      gpuUnavailableEl.style.display = (gpuAvailable === false) ? '' : 'none';
    }
    if (fasterUnavailableEl) {
      fasterUnavailableEl.style.display = (fasterAvailable === false) ? '' : 'none';
    }
    gpuOption.classList.toggle('disabled', gpuAvailable === false);
    if (fasterOption) fasterOption.classList.toggle('disabled', fasterAvailable === false);
  }

  function toggleDropdown(e) {
    if (e) e.stopPropagation();
    if (!dropdownEl) return;
    var show = dropdownEl.style.display === 'none';
    dropdownEl.style.display = show ? 'flex' : 'none';
    if (show) {
      // Close dropdown on any outside click
      setTimeout(function () {
        document.addEventListener('click', closeDropdown, { once: true });
      }, 0);
    }
  }

  function closeDropdown() {
    if (dropdownEl) dropdownEl.style.display = 'none';
  }

  function selectBackend(b) {
    if (b === 'gpu' && gpuAvailable === false) return;
    if (b === 'faster' && fasterAvailable === false) return;
    if (b === backend) return;
    var wasActive = active;
    if (wasActive) stop();
    backend = b;
    log('Backend changed', { backend: backend });
    updateDropdownUI();
    closeDropdown();

    // Notify renderer to persist (fires a custom event)
    P._emit('transcription-backend-changed', { backend: backend });

    if (wasActive) start();
  }

  /* ── Public API ───────────────────────────────────────────── */

  function start() {
    if (active) return;
    active = true;
    log('Transcription starting', { backend: backend });
    showPanel(true);
    if (toggleBtn) toggleBtn.classList.add('active');

    if (backend === 'faster') {
      setStatus('loading', 'Starting faster-whisper...');
      startCapture();
    } else if (backend === 'gpu') {
      setStatus('ready', 'Listening (GPU)...');
      startCapture();
    } else {
      ensureWorker();
      if (!modelReady && !modelLoading) {
        modelLoading = true;
        worker.postMessage({ type: 'init' });
      } else if (modelReady) {
        setStatus('ready', 'Listening...');
        startCapture();
      }
    }
  }

  function stop() {
    if (!active) return;
    active = false;
    log('Transcription stopping');
    stopCapture();
    setStatus('off', 'Stopped');
    if (toggleBtn) toggleBtn.classList.remove('active');
  }

  function toggle() { active ? stop() : start(); }

  function reset() {
    stop();
    showPanel(false);
    clear();
    log('Transcription reset');
  }

  function clear() {
    lines = [];
    searchQuery = '';
    lastGpuText = '';
    if (searchInput) searchInput.value = '';
    if (bodyEl) bodyEl.innerHTML = '<div class="transcript-empty">Transcript lines will appear here...</div>';
  }

  function isActive() { return active; }

  function setBackend(b) {
    if (b !== 'cpu' && b !== 'gpu' && b !== 'faster') return;
    backend = b;
    updateDropdownUI();
    log('Backend set', { backend: backend });
  }

  function getBackend() { return backend; }

  /* ── Bind DOM ─────────────────────────────────────────────── */

  function bindTranscription() {
    panelEl          = document.getElementById('transcriptPanel');
    bodyEl           = document.getElementById('transcriptBody');
    statusEl         = document.getElementById('transcriptStatus');
    toggleBtn        = document.getElementById('transcriptToggle');
    searchInput      = document.getElementById('transcriptSearch');
    exportBtn        = document.getElementById('transcriptExportBtn');
    dropdownEl          = document.getElementById('ccDropdown');
    cpuOption           = document.getElementById('ccOptCpu');
    gpuOption           = document.getElementById('ccOptGpu');
    fasterOption        = document.getElementById('ccOptFaster');
    gpuUnavailableEl    = document.getElementById('ccGpuUnavailable');
    fasterUnavailableEl = document.getElementById('ccFasterUnavailable');

    // CC button: left-click toggles transcription, right-click opens dropdown
    if (toggleBtn) {
      toggleBtn.onclick = function (e) { e.stopPropagation(); toggle(); };
      toggleBtn.oncontextmenu = function (e) {
        e.preventDefault();
        e.stopPropagation();
        toggleDropdown(e);
      };
    }

    // Dropdown chevron button
    var chevronBtn = document.getElementById('ccDropdownChevron');
    if (chevronBtn) {
      chevronBtn.onclick = function (e) { e.stopPropagation(); toggleDropdown(e); };
    }

    if (cpuOption) cpuOption.onclick = function (e) { e.stopPropagation(); selectBackend('cpu'); };
    if (gpuOption) gpuOption.onclick = function (e) { e.stopPropagation(); selectBackend('gpu'); };
    if (fasterOption) fasterOption.onclick = function (e) { e.stopPropagation(); selectBackend('faster'); };

    var clearBtn = document.getElementById('transcriptClearBtn');
    if (clearBtn) clearBtn.onclick = function (e) { e.stopPropagation(); clear(); };
    if (searchInput) searchInput.oninput = onSearchInput;
    if (exportBtn) exportBtn.onclick = function (e) { e.stopPropagation(); exportTranscript(); };

    // Check backend availability
    if (window.clipper && window.clipper.whisperAvailable) {
      window.clipper.whisperAvailable().then(function (avail) {
        gpuAvailable = avail;
        log('GPU whisper availability', { available: avail });
        updateDropdownUI();
      });
    }
    if (window.clipper && window.clipper.fasterWhisperAvailable) {
      window.clipper.fasterWhisperAvailable().then(function (avail) {
        fasterAvailable = avail;
        log('faster-whisper availability', { available: avail });
        updateDropdownUI();
      });
    }

    // Listen for faster-whisper model download/load progress
    if (window.clipper && window.clipper.onFwProgress) {
      window.clipper.onFwProgress(function (data) {
        if (backend === 'faster' && active) {
          setStatus('loading', data.msg || 'Loading model...');
        }
      });
    }

    // Restart audio capture when a new stream loads
    P.on('streamready', function () {
      if (active) {
        stopCapture();
        setTimeout(function () {
          if (active && (backend === 'gpu' || backend === 'faster' || modelReady)) startCapture();
        }, 1000);
      }
    });

    log('bindTranscription — complete');
  }

  /* ── Export module ─────────────────────────────────────────── */

  P.transcription = {
    bindTranscription: bindTranscription,
    toggle: toggle,
    start: start,
    stop: stop,
    reset: reset,
    clear: clear,
    isActive: isActive,
    setBackend: setBackend,
    getBackend: getBackend,
    exportTranscript: exportTranscript,
    search: function (q) {
      searchQuery = (q || '').trim();
      if (searchInput) searchInput.value = searchQuery;
      renderAllLines();
    },
  };
})();

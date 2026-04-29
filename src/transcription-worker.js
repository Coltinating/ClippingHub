/**
 * Transcription Worker — runs Whisper speech recognition via @xenova/transformers.
 *
 * Messages IN:
 *   { type: 'init' }                       — load the model
 *   { type: 'transcribe', audio, id }      — transcribe Float32Array audio (16 kHz mono)
 *   { type: 'abort' }                      — cancel in-flight work (best-effort)
 *
 * Messages OUT:
 *   { type: 'status', status }             — 'loading' | 'ready' | 'error'
 *   { type: 'progress', progress }         — model download progress (0–100)
 *   { type: 'result', text, id }           — transcription result
 *   { type: 'error', error, id? }          — error description
 */

let pipeline = null;
let transcriber = null;

/* ─────────────────────────────────────────────────────────────
   Persistent IndexedDB-backed fetch cache.

   The default Cache API used by @xenova/transformers does not
   reliably persist across sessions in our Electron worker context,
   so we install a fetch shim that stores model file responses in
   IndexedDB. Subsequent worker spins (or app restarts) read the
   model from IndexedDB instead of re-downloading from HuggingFace.
   ───────────────────────────────────────────────────────────── */
const IDB_NAME = 'ch-transcription-cache';
const IDB_STORE = 'responses';
const IDB_VERSION = 1;
// Only intercept HuggingFace model URLs — other fetches pass through unchanged.
const CACHE_HOST_RE = /^https:\/\/huggingface\.co\//;

function _openDB() {
  return new Promise(function (resolve, reject) {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = function () {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function _idbGet(key) {
  return _openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const store = tx.objectStore(IDB_STORE);
      const r = store.get(key);
      r.onsuccess = function () { resolve(r.result || null); };
      r.onerror = function () { reject(r.error); };
    });
  }).catch(function () { return null; });
}

function _idbPut(key, record) {
  return _openDB().then(function (db) {
    return new Promise(function (resolve, reject) {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const r = store.put(record, key);
      r.onsuccess = function () { resolve(); };
      r.onerror = function () { reject(r.error); };
    });
  }).catch(function () { /* swallow — cache is best-effort */ });
}

const _origFetch = self.fetch.bind(self);
self.fetch = async function (input, init) {
  const url = (typeof input === 'string') ? input : (input && input.url) || '';
  if (!CACHE_HOST_RE.test(url)) {
    return _origFetch(input, init);
  }
  // Cache hit?
  try {
    const cached = await _idbGet(url);
    if (cached && cached.body && cached.headers) {
      return new Response(cached.body, {
        status: 200,
        statusText: 'OK (cached)',
        headers: cached.headers,
      });
    }
  } catch (_) { /* ignore */ }

  // Cache miss — fetch and persist
  const res = await _origFetch(input, init);
  if (res && res.ok) {
    try {
      const clone = res.clone();
      const buf = await clone.arrayBuffer();
      const headers = {};
      clone.headers.forEach(function (v, k) { headers[k] = v; });
      await _idbPut(url, { body: buf, headers: headers, savedAt: Date.now() });
    } catch (_) { /* persistence is best-effort */ }
  }
  return res;
};

async function loadPipeline() {
  /* Dynamic import from CDN — the document CSP allows cdn.jsdelivr.net */
  const mod = await import(
    'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'
  );
  pipeline = mod.pipeline;
  // Defensively configure cache flags. These are the documented v2 options.
  if (mod.env) {
    try { mod.env.useBrowserCache = true; } catch (_) {}
    try { mod.env.allowRemoteModels = true; } catch (_) {}
    try { mod.env.allowLocalModels = false; } catch (_) {}
  }
}

async function initModel() {
  self.postMessage({ type: 'status', status: 'loading' });
  try {
    await loadPipeline();
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      progress_callback: function (p) {
        if (p.status === 'progress' && p.progress != null) {
          self.postMessage({ type: 'progress', progress: Math.round(p.progress) });
        }
      },
    });
    self.postMessage({ type: 'status', status: 'ready' });
  } catch (err) {
    self.postMessage({ type: 'status', status: 'error' });
    self.postMessage({ type: 'error', error: err.message || String(err) });
  }
}

async function transcribe(audio, id, time) {
  if (!transcriber) {
    self.postMessage({ type: 'error', error: 'Model not loaded', id: id });
    return;
  }
  try {
    var result = await transcriber(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });
    var text = (result.text || '').trim();
    self.postMessage({ type: 'result', text: text, id: id, time: time });
  } catch (err) {
    self.postMessage({ type: 'error', error: err.message || String(err), id: id });
  }
}

self.onmessage = function (e) {
  var msg = e.data;
  if (msg.type === 'init') {
    initModel();
  } else if (msg.type === 'transcribe') {
    transcribe(msg.audio, msg.id, msg.time);
  }
};

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

async function loadPipeline() {
  /* Dynamic import from CDN — the document CSP allows cdn.jsdelivr.net */
  const { pipeline: createPipeline } = await import(
    'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2'
  );
  pipeline = createPipeline;
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

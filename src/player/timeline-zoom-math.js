// Pure math for the timeline-zoom component. No DOM, no state, no side effects.
// Hybrid CJS/window export — loadable by vitest (require) and by the renderer
// (<script> tag → window.TimelineZoomMath).

function timeToFrac(view, t) {
  const span = view.end - view.start;
  return span <= 0 ? 0 : (t - view.start) / span;
}

function fracToTime(view, f) {
  return view.start + f * (view.end - view.start);
}

function clampView(view, total) {
  const span = view.end - view.start;
  let start = view.start;
  if (start < 0) start = 0;
  if (start > total - span) start = total - span;
  if (start < 0) start = 0;
  return { start, end: start + Math.min(span, total) };
}

function zoomAround(view, cursorFrac, factor, total, minSpan) {
  const cursorTime = fracToTime(view, cursorFrac);
  let newSpan = (view.end - view.start) * factor;
  newSpan = Math.max(minSpan, Math.min(total, newSpan));
  let start = cursorTime - cursorFrac * newSpan;
  return clampView({ start, end: start + newSpan }, total);
}

function shiftView(view, deltaSec, total) {
  return clampView({ start: view.start + deltaSec, end: view.end + deltaSec }, total);
}

// Aim for ~8-14 major ticks across the visible width.
function pickTickStep(spanSec) {
  const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
  for (const c of candidates) {
    if (spanSec / c <= 14) return c;
  }
  return 7200;
}

// Pixel-uniform edge auto-pan: returns the shift (in seconds, signed) to apply
// per frame given cursor position. 0 if cursor is outside the edge zone.
function edgeAutoPanShift({ localX, width, span, edgeFrac, pxPerFrame }) {
  if (width <= 0) return 0;
  const edge = width * edgeFrac;
  let intensity = 0;
  let dir = 0;
  if (localX < edge) { intensity = 1 - Math.max(0, localX / edge); dir = -1; }
  else if (localX > width - edge) { intensity = 1 - Math.max(0, (width - localX) / edge); dir = +1; }
  if (intensity <= 0) return 0;
  const secPerPx = span / width;
  return dir * pxPerFrame * intensity * secPerPx;
}

const exportsObj = {
  timeToFrac, fracToTime, clampView, zoomAround, shiftView, pickTickStep, edgeAutoPanShift,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = exportsObj;
}
if (typeof window !== 'undefined') {
  window.TimelineZoomMath = exportsObj;
}
